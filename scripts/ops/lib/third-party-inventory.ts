/**
 * Third-party showroom sheets → one Katana product per item name.
 * Each CSV row is a variant. The Spec string is what the showroom card prints.
 *
 * Headers are file row 3. In, Out, blank columns, and the unheaded
 * "Fame Only" note are not imported.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsvLine } from "./csv";

export const THIRD_PARTY_DIR = join(process.cwd(), "data_migration", "3rd Party Items");

const FILES = {
  tenjam: "CURRENT 3RD PARTY ITEMS INVENTORY.xlsx - TEN JAM.csv",
  fim: "CURRENT 3RD PARTY ITEMS INVENTORY.xlsx - FIM SHADE SYSTEMS.csv",
  scolaro: "CURRENT 3RD PARTY ITEMS INVENTORY.xlsx - SCOLARO UMBRELLAS.csv",
} as const;

export type ThirdPartySource = keyof typeof FILES;

export type ThirdPartyCategory = "Tenjam" | "Flexy" | "Umbrellas";

export type ThirdPartyLine = {
  source: ThirdPartySource;
  productName: string;
  category: ThirdPartyCategory;
  spec: string;
  sku: string;
  onHand: number;
};

export type ThirdPartyProduct = {
  productName: string;
  category: ThirdPartyCategory;
  lines: ThirdPartyLine[];
};

const IGNORED_HEADERS = new Set(["in", "out"]);

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("/")
        .map((part) => {
          if (!part || /^[0-9]/.test(part)) return part;
          const lower = part.toLowerCase();
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join("/"),
    )
    .join(" ");
}

function skuToken(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function joinSku(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join("-");
}

function qty(raw: string, label: string): number {
  const cleaned = raw.replace(/[,\s]/g, "").trim();
  if (!cleaned) throw new Error(`${label} is blank.`);
  const value = Number(cleaned);
  if (!Number.isFinite(value)) throw new Error(`${label} is not a number (${raw}).`);
  if (value < 0) throw new Error(`${label} is negative.`);
  return Math.round(value * 10000) / 10000;
}

function readSheet(path: string): Record<string, string>[] {
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);
  let headerIndex = 2;
  const headerProbe = parseCsvLine(lines[headerIndex] ?? "");
  if (headerProbe[0]?.trim().toLowerCase() !== "vendor") {
    headerIndex = lines.findIndex(
      (line) => parseCsvLine(line)[0]?.trim().toLowerCase() === "vendor",
    );
  }
  if (headerIndex < 0) throw new Error(`No Vendor header in ${path}.`);
  const headers = parseCsvLine(lines[headerIndex]!).map((header) => header.trim());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.every((cell) => !cell.trim())) continue;
    const row: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index] ?? "";
      if (!header || IGNORED_HEADERS.has(header.toLowerCase())) continue;
      row[header] = (cols[index] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function cell(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && value.trim()) return value.trim();
  }
  return "";
}

function blankAttribute(value: string): boolean {
  const key = value.trim().toUpperCase();
  return !key || key === "NONE" || key === "-";
}

function tenjamLine(row: Record<string, string>): ThirdPartyLine {
  const type = cell(row, "Type");
  const color = cell(row, "Color");
  if (!type) throw new Error("Tenjam row is missing Type.");
  const spec = blankAttribute(color) ? "" : `Color: ${color}`;
  const productName = `Tenjam ${titleCase(type)}`;
  return {
    source: "tenjam",
    productName,
    category: "Tenjam",
    spec,
    sku: joinSku(["3P-TJM", skuToken(type), spec ? skuToken(color) : "STD"]),
    onHand: qty(row["Total on Hand"] ?? "", `${productName} Total on Hand`),
  };
}

function fimLine(row: Record<string, string>): ThirdPartyLine {
  const type = cell(row, "Type");
  const canopy = cell(row, "CANOPY", "Canopy");
  if (!type || !canopy) throw new Error("FIM row is missing Type or canopy.");
  const productName = `FIM ${titleCase(type)}`;
  const spec = `Canopy: ${canopy}`;
  return {
    source: "fim",
    productName,
    category: "Flexy",
    spec,
    sku: joinSku(["3P-ESY", skuToken(type), skuToken(canopy)]),
    onHand: qty(row["Total on Hand"] ?? "", `${productName} Total on Hand`),
  };
}

function scolSizeParts(size: string, feet: string, shape: string): string[] {
  const sizeKey = size.trim().toUpperCase();
  const shapeCode = shape.trim().toUpperCase();
  if (sizeKey === "BASE" || sizeKey === "COVER") {
    return [sizeKey, shapeCode].filter(Boolean);
  }
  const measured = [feet.trim(), shapeCode].filter(Boolean).join(" ");
  return measured ? [measured] : [];
}

function scolSkuSize(size: string, feet: string, shape: string): string[] {
  const sizeKey = size.trim().toUpperCase();
  const shapeCode = shape.trim().toUpperCase();
  if (sizeKey === "BASE" || sizeKey === "COVER") return [sizeKey, shapeCode];
  const feetCode = feet.replace(/[^0-9.]+/g, "").replace(".", "");
  return [feetCode || skuToken(size), shapeCode];
}

function scolaroLine(row: Record<string, string>): ThirdPartyLine {
  const size = cell(row, "Size (M)");
  const type = cell(row, "Type");
  const shape = cell(row, "Shape");
  const canopy = cell(row, "Canopy");
  const frame = cell(row, "Frame");
  const feet = cell(row, "Feet");
  if (!size || !type || !shape || !canopy || !frame) {
    throw new Error("Scolaro row is missing size, type, shape, canopy, or frame.");
  }
  const productName = `Scolaro ${titleCase(type)}`;
  const parts = [...scolSizeParts(size, feet, shape)];
  if (!blankAttribute(canopy)) parts.push(`Canopy: ${canopy}`);
  if (!blankAttribute(frame)) parts.push(`Frame: ${frame}`);
  const spec = parts.filter(Boolean).join(" - ");
  const sku = joinSku([
    "3P-UMB",
    skuToken(type),
    ...scolSkuSize(size, feet, shape),
    blankAttribute(canopy) ? null : skuToken(canopy),
    blankAttribute(frame) ? null : skuToken(frame),
  ]);
  return {
    source: "scolaro",
    productName,
    category: "Umbrellas",
    spec,
    sku,
    onHand: qty(row["Total on Hand"] ?? "", `${productName} Total on Hand`),
  };
}

function assertUnique(lines: ThirdPartyLine[]): void {
  const skus = new Map<string, string>();
  const specs = new Map<string, string>();
  for (const line of lines) {
    const label = `${line.productName} / ${line.spec || "(no spec)"}`;
    const previous = skus.get(line.sku);
    if (previous) {
      throw new Error(`SKU ${line.sku} is used by "${previous}" and "${label}".`);
    }
    skus.set(line.sku, label);
    const specKey = `${line.category}::${line.productName}::${line.spec.toLowerCase()}`;
    const previousSpec = specs.get(specKey);
    if (previousSpec) {
      throw new Error(
        `${line.productName} already has Spec "${line.spec || "(no spec)"}" on ${previousSpec} and ${line.sku}.`,
      );
    }
    specs.set(specKey, line.sku);
  }
}

export function loadThirdPartyLines(directory = THIRD_PARTY_DIR): ThirdPartyLine[] {
  const tenjam = readSheet(join(directory, FILES.tenjam)).map(tenjamLine);
  const fim = readSheet(join(directory, FILES.fim)).map(fimLine);
  const scolaro = readSheet(join(directory, FILES.scolaro)).map(scolaroLine);
  const lines = [...tenjam, ...fim, ...scolaro];
  assertUnique(lines);
  return lines;
}

export function groupThirdPartyProducts(lines: ThirdPartyLine[]): ThirdPartyProduct[] {
  const groups = new Map<string, ThirdPartyProduct>();
  for (const line of lines) {
    const key = `${line.category}::${line.productName}`;
    const group = groups.get(key) ?? {
      productName: line.productName,
      category: line.category,
      lines: [],
    };
    group.lines.push(line);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (left, right) =>
      left.productName.localeCompare(right.productName) ||
      left.category.localeCompare(right.category),
  );
}

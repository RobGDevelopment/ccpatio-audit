/**
 * Reconcile Sergio's physical counts onto Hub SKUs and emit Katana import CSVs.
 *
 * Katana rows come from data_migration/Update existing materials.csv.
 * That export repeats each material once per location. The cleanse keeps the
 * CC Manufacturing row and its Katana ID. Materials updates and the pilot
 * file lead with Katana ID so Katana can overwrite the variant code.
 *
 * Fabric codes come from docs/Katana Downloads/MaterialList-2026-09-14-16_16.csv.
 * Dekton sheet spellings come from DEKTON_SHEET_ALIASES in scripts/ops/seed-dekton-aliases.ts.
 * Firepit codes stay in the FRP-HPC- namespace. Metal, powder, packaging, and wood
 * rows are ignored.
 *
 * Default is a dry run (summary only). Pass --write to write the import CSVs
 * and pilot-test.csv under data_migration/reports/. If both --dry-run and
 * --write are present, nothing is written.
 *
 * Fabric In stock on the stock CSV is physical on-hand: STOCK AVAILABLE + FOR CUSTOMER.
 * Katana subtracts Committed from In stock, so writing only available yards would
 * double-count holds and drive availability negative. The exception file still
 * logs those two quantities separately.
 *
 * Import order: materials update, then stock update, then creates.
 *
 *   npm run migrate:cleanse-katana
 *   npm run migrate:cleanse-katana -- --write
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEKTON_SHEET_ALIASES } from "../ops/seed-dekton-aliases";
import { col, parseCsvLine } from "../ops/lib/csv";

const LOCATION = "CC Manufacturing";
const DATA_DIR = join(process.cwd(), "data_migration");
const REPORT_DIR = join(DATA_DIR, "reports");
const DICTIONARY_PATH = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "MaterialList-2026-09-14-16_16.csv",
);

const MATERIALS_HEADERS = [
  "Katana ID",
  "Material name",
  "Variant code / SKU",
  "Supplier item code",
  "Category",
  "Unit of measure",
  "Buy?",
  "Default supplier",
] as const;

const STOCK_HEADERS = [
  "Material name",
  "Variant code / SKU",
  "In stock",
  "Location",
] as const;

const CREATE_HEADERS = [
  "Material name",
  "Variant code / SKU",
  "Supplier item code",
  "Category",
  "Unit of measure",
  "Buy?",
  "Default supplier",
  "In stock",
] as const;

const EXCEPTION_HEADERS = [
  "action",
  "family",
  "name",
  "current_sku",
  "proposed_sku",
  "quantity",
  "for_customer",
  "detail",
] as const;

type Family = "fabric" | "dekton" | "firepit";

type ExceptionAction =
  | "LEAVE_UNTOUCHED"
  | "UNMAPPED"
  | "COLLISION"
  | "BALANCE_BREAK"
  | "FOR_CUSTOMER_HOLD"
  | "MALFORMED"
  | "REVIEW";

type KatanaItem = {
  katanaId: string;
  name: string;
  nameKey: string;
  sku: string;
  category: string;
  supplier: string;
  uom: string;
  location: string;
  inStock: string;
};

type ExceptionRow = {
  action: ExceptionAction;
  family: Family;
  name: string;
  nameKey: string;
  currentSku: string;
  proposedSku: string;
  quantity: string;
  forCustomer: string;
  detail: string;
};

type MaterialRow = {
  family: "fabric" | "firepit";
  skuChanged: boolean;
  katanaId: string;
  materialName: string;
  sku: string;
  supplierItemCode: string;
  category: string;
  uom: string;
  defaultSupplier: string;
};

type StockRow = {
  family: Family;
  materialName: string;
  sku: string;
  inStock: number;
  location: string;
};

type CreateRow = {
  family: "fabric" | "firepit";
  materialName: string;
  sku: string;
  supplierItemCode: string;
  category: string;
  uom: string;
  defaultSupplier: string;
  inStock: number;
};

type FabricBin = {
  rawName: string;
  vendorSku: string;
  bin: string;
  entries: number;
  outputs: number;
  reserved: number;
  available: number;
  issue: string | null;
};

type SkuOwner = {
  sku: string;
  nameKey: string;
};

function norm(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roundQty(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function num(value: string | undefined): number {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) return 0;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return roundQty(parsed);
}

function formatQty(value: number): string {
  const rounded = roundQty(value);
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

function thickSuffix(raw: string): string | null {
  const parsed = Number(String(raw ?? "").trim());
  if (!Number.isFinite(parsed)) return null;
  if (Math.abs(parsed - 1.2) < 0.01) return "1.2";
  if (Math.abs(parsed - 2) < 0.01) return "2.0";
  return null;
}

function firepitSku(code: string): string | null {
  const stripped = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!stripped) return null;
  return `FRP-HPC-${stripped}`;
}

function firepitCategory(sheetCategory: string): string {
  const key = norm(sheetCategory);
  if (key === "FIRE GLASS") return "Fire Glass";
  if (key === "ACCESSORY") return "Firepit Accessory";
  return "Firepit";
}

function familyOf(item: KatanaItem): Family | "other" {
  const category = norm(item.category);
  const sku = item.sku.toUpperCase();
  if (category === "FABRIC" || sku.startsWith("FAB-")) return "fabric";
  if (category === "DEKTON" || sku.startsWith("STN-DKT-")) return "dekton";
  if (category === "FIREPIT" || sku.startsWith("FRP-HPC-")) return "firepit";
  return "other";
}

function findCsv(part: string): string {
  const hit = readdirSync(DATA_DIR).find(
    (name) => name.toLowerCase().includes(part.toLowerCase()) && name.toLowerCase().endsWith(".csv"),
  );
  if (!hit) throw new Error(`No CSV in data_migration matching "${part}"`);
  return join(DATA_DIR, hit);
}

function readSheet(path: string, headerIncludes: string, required: string[]): Record<string, string>[] {
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/);
  const headerIdx = lines.findIndex((line) => line.includes(headerIncludes));
  if (headerIdx < 0) {
    throw new Error(`${path} has no header containing "${headerIncludes}"`);
  }
  const headers = parseCsvLine(lines[headerIdx]!).map((cell) => cell.trim().replace(/^\uFEFF/, ""));
  const missing = required.filter((name) => !headers.includes(name));
  if (missing.length > 0) {
    throw new Error(`${path} is missing columns: ${missing.join(", ")}`);
  }
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]!] = (cols[i] ?? "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsv(headers: readonly string[], rows: string[][]): string {
  const lines = [headers.join(","), ...rows.map((row) => row.map(csvEscape).join(","))];
  return `${lines.join("\n")}\n`;
}

function katanaItemFromRow(row: Record<string, string>): KatanaItem {
  const name = col(row, "Material name", "Name");
  return {
    katanaId: col(row, "Katana ID (required)", "Katana ID"),
    name,
    nameKey: norm(name),
    sku: col(row, "Variant code", "Variant code / SKU").toUpperCase(),
    category: col(row, "Category"),
    supplier: col(row, "Default supplier"),
    uom: col(row, "Unit of measure", "Units of measure"),
    location: col(row, "Location") || LOCATION,
    inStock: col(row, "In stock"),
  };
}

function loadKatana(path: string): {
  items: KatanaItem[];
  bySku: Map<string, KatanaItem>;
  fabricByName: Map<string, KatanaItem[]>;
  dektonByName: Map<string, KatanaItem[]>;
  skuOwners: Map<string, SkuOwner>;
  ignored: number;
} {
  const rows = readSheet(path, "Katana ID", [
    "Katana ID (required)",
    "Material name",
    "Category",
    "Unit of measure",
    "Default supplier",
    "Variant code",
    "Location",
  ]);
  const byId = new Map<string, KatanaItem[]>();
  for (const row of rows) {
    const item = katanaItemFromRow(row);
    if (!item.katanaId && !item.name && !item.sku) continue;
    if (!item.katanaId) {
      throw new Error(`Katana row "${item.name || item.sku}" has no Katana ID`);
    }
    const list = byId.get(item.katanaId) ?? [];
    list.push(item);
    byId.set(item.katanaId, list);
  }

  const items: KatanaItem[] = [];
  for (const list of byId.values()) {
    const atFactory = list.find((item) => norm(item.location) === norm(LOCATION));
    items.push(atFactory ?? list[0]!);
  }

  const bySku = new Map<string, KatanaItem>();
  const fabricByName = new Map<string, KatanaItem[]>();
  const dektonByName = new Map<string, KatanaItem[]>();
  const skuOwners = new Map<string, SkuOwner>();
  let ignored = 0;

  for (const item of items) {
    const family = familyOf(item);
    if (family === "other") {
      ignored += 1;
      continue;
    }
    if (item.sku) {
      const owner = skuOwners.get(item.sku);
      if (!owner) {
        skuOwners.set(item.sku, { sku: item.sku, nameKey: item.nameKey });
        bySku.set(item.sku, item);
      }
    }
    if (family === "fabric" && item.nameKey) {
      const list = fabricByName.get(item.nameKey) ?? [];
      list.push(item);
      fabricByName.set(item.nameKey, list);
    }
    if (family === "dekton" && item.nameKey) {
      const list = dektonByName.get(item.nameKey) ?? [];
      list.push(item);
      dektonByName.set(item.nameKey, list);
    }
  }

  return { items, bySku, fabricByName, dektonByName, skuOwners, ignored };
}

function loadFabricDictionary(path: string): {
  byName: Map<string, string>;
  ambiguous: Map<string, string[]>;
} {
  const rows = readSheet(path, "Variant code / SKU", ["Name", "Variant code / SKU"]);
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    const sku = col(row, "Variant code / SKU").toUpperCase();
    const nameKey = norm(col(row, "Name"));
    if (!nameKey || !sku.startsWith("FAB-")) continue;
    const set = grouped.get(nameKey) ?? new Set<string>();
    set.add(sku);
    grouped.set(nameKey, set);
  }
  const byName = new Map<string, string>();
  const ambiguous = new Map<string, string[]>();
  for (const [nameKey, skus] of grouped) {
    const list = [...skus];
    if (list.length === 1) byName.set(nameKey, list[0]!);
    else ambiguous.set(nameKey, list);
  }
  return { byName, ambiguous };
}

function dektonAliasMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of DEKTON_SHEET_ALIASES) {
    map.set(norm(row.aliasSku), row.canonicalSku.trim().toUpperCase());
  }
  return map;
}

function parseFabricBins(rows: Record<string, string>[]): Map<string, FabricBin[]> {
  const groups = new Map<string, FabricBin[]>();
  for (const row of rows) {
    const rawName = col(row, "FABRIC");
    const vendorSku = col(row, "SKU NUMBER");
    const bin = col(row, "BIN");
    const entriesText = col(row, "TOTAL ENTRIES");
    const outputsText = col(row, "TOTAL OUTPUTS");
    const reservedText = col(row, "FOR CUSTOMER");
    const availableText = col(row, "STOCK AVAILABLE");
    // Trailing sheet rows are a row number plus a zero available count and no name.
    if (!rawName && !vendorSku) continue;

    const entries = num(entriesText);
    const outputs = num(outputsText);
    const reserved = num(reservedText);
    const available = num(availableText);
    let issue: string | null = null;
    if (!rawName) {
      issue = "Fabric row has quantities but no FABRIC name";
    } else if ([entries, outputs, reserved, available].some((value) => Number.isNaN(value))) {
      issue = `Non-numeric quantity (entries=${entriesText || "0"}, outputs=${outputsText || "0"}, for_customer=${reservedText || "0"}, available=${availableText || "0"})`;
    } else if (entries < 0 || outputs < 0 || reserved < 0 || available < 0) {
      issue = "Negative quantity";
    } else {
      const physical = roundQty(entries - outputs);
      const cross = roundQty(available + reserved);
      if (Math.abs(physical - cross) > 0.001) {
        issue = `bin ${bin || "—"}: entries-outputs=${formatQty(physical)} available+for_customer=${formatQty(cross)}`;
      } else if (physical < 0) {
        issue = `bin ${bin || "—"}: negative physical ${formatQty(physical)}`;
      }
    }

    const nameKey = norm(rawName);
    const binRow: FabricBin = {
      rawName,
      vendorSku,
      bin,
      entries: Number.isNaN(entries) ? 0 : entries,
      outputs: Number.isNaN(outputs) ? 0 : outputs,
      reserved: Number.isNaN(reserved) ? 0 : reserved,
      available: Number.isNaN(available) ? 0 : available,
      issue,
    };
    const list = groups.get(nameKey) ?? [];
    list.push(binRow);
    groups.set(nameKey, list);
  }
  return groups;
}

function vendorCode(bins: FabricBin[]): { code: string; conflict: string[] } {
  const seen = new Map<string, string>();
  for (const bin of bins) {
    const code = bin.vendorSku.trim();
    if (!code) continue;
    seen.set(code.toUpperCase(), code);
  }
  const codes = [...seen.values()];
  if (codes.length <= 1) return { code: codes[0] ?? "", conflict: [] };
  return { code: "", conflict: codes };
}

function ownedBySomeoneElse(
  skuOwners: Map<string, SkuOwner>,
  sku: string,
  nameKey: string,
): boolean {
  const owner = skuOwners.get(sku);
  if (!owner) return false;
  return owner.nameKey !== nameKey;
}

function pushException(target: ExceptionRow[], row: ExceptionRow): void {
  target.push(row);
}

function reconcileFabrics(
  binsByName: Map<string, FabricBin[]>,
  fabricByName: Map<string, KatanaItem[]>,
  dictionary: Map<string, string>,
  ambiguous: Map<string, string[]>,
  skuOwners: Map<string, SkuOwner>,
  materials: MaterialRow[],
  stock: StockRow[],
  creates: CreateRow[],
  exceptions: ExceptionRow[],
  matched: Set<string>,
): void {
  type Plan = {
    nameKey: string;
    displayName: string;
    katana: KatanaItem | null;
    proposedSku: string | null;
    supplierItemCode: string;
    available: number;
    reserved: number;
    stockEligible: boolean;
    blocked: boolean;
  };

  const plans: Plan[] = [];

  for (const [nameKey, bins] of binsByName) {
    if (!nameKey) {
      for (const bin of bins) {
        pushException(exceptions, {
          action: "MALFORMED",
          family: "fabric",
          name: bin.rawName || "(blank)",
          nameKey: "",
          currentSku: "",
          proposedSku: "",
          quantity: "",
          forCustomer: "",
          detail: bin.issue ?? "Blank fabric name",
        });
      }
      continue;
    }

    const displayName = bins.find((bin) => bin.rawName.trim())?.rawName.trim() ?? nameKey;
    const katanaHits = fabricByName.get(nameKey) ?? [];
    const issues = bins.filter((bin) => bin.issue);
    const stockEligible = issues.length === 0;
    const available = roundQty(bins.reduce((sum, bin) => sum + (bin.issue ? 0 : bin.available), 0));
    const reserved = roundQty(bins.reduce((sum, bin) => sum + (bin.issue ? 0 : bin.reserved), 0));

    for (const bin of issues) {
      pushException(exceptions, {
        action: bin.issue?.startsWith("Non-numeric") || bin.issue?.includes("no FABRIC") || bin.issue === "Negative quantity"
          ? "MALFORMED"
          : "BALANCE_BREAK",
        family: "fabric",
        name: displayName,
        nameKey,
        currentSku: katanaHits[0]?.sku ?? "",
        proposedSku: "",
        quantity: formatQty(bin.available),
        forCustomer: formatQty(bin.reserved),
        detail: bin.issue ?? "Balance break",
      });
    }

    if (katanaHits.length > 1) {
      pushException(exceptions, {
        action: "COLLISION",
        family: "fabric",
        name: displayName,
        nameKey,
        currentSku: katanaHits.map((item) => item.sku).join("|"),
        proposedSku: "",
        quantity: stockEligible ? formatQty(available) : "",
        forCustomer: formatQty(reserved),
        detail: `More than one Katana fabric row is named ${displayName}`,
      });
      for (const item of katanaHits) if (item.sku) matched.add(item.sku);
      continue;
    }

    const katana = katanaHits[0] ?? null;
    if (katana?.sku) matched.add(katana.sku);

    const vendor = vendorCode(bins);
    if (vendor.conflict.length > 0) {
      pushException(exceptions, {
        action: "COLLISION",
        family: "fabric",
        name: displayName,
        nameKey,
        currentSku: katana?.sku ?? "",
        proposedSku: "",
        quantity: stockEligible ? formatQty(available) : "",
        forCustomer: formatQty(reserved),
        detail: `Sheet rows disagree on vendor SKU: ${vendor.conflict.join(", ")}`,
      });
      continue;
    }

    const ambiguousSkus = ambiguous.get(nameKey);
    if (ambiguousSkus) {
      pushException(exceptions, {
        action: "COLLISION",
        family: "fabric",
        name: displayName,
        nameKey,
        currentSku: katana?.sku ?? "",
        proposedSku: ambiguousSkus.join("|"),
        quantity: stockEligible ? formatQty(available) : "",
        forCustomer: formatQty(reserved),
        detail: "Fabric dictionary has more than one FAB- code for this name",
      });
      continue;
    }

    let proposedSku: string | null = null;
    if (katana?.sku.startsWith("FAB-")) {
      proposedSku = katana.sku;
    } else {
      proposedSku = dictionary.get(nameKey) ?? null;
    }

    if (!proposedSku) {
      pushException(exceptions, {
        action: "UNMAPPED",
        family: "fabric",
        name: displayName,
        nameKey,
        currentSku: katana?.sku ?? "",
        proposedSku: "",
        quantity: stockEligible ? formatQty(available) : "",
        forCustomer: formatQty(reserved),
        detail: "No FAB- code in the September material dictionary",
      });
      continue;
    }

    let supplierItemCode = vendor.code;
    if (!supplierItemCode && katana && !katana.sku.startsWith("FAB-")) {
      supplierItemCode = katana.sku;
    }

    plans.push({
      nameKey,
      displayName,
      katana,
      proposedSku,
      supplierItemCode,
      available,
      reserved,
      stockEligible,
      blocked: false,
    });
  }

  const byProposed = new Map<string, Plan[]>();
  for (const plan of plans) {
    if (!plan.proposedSku) continue;
    const list = byProposed.get(plan.proposedSku) ?? [];
    list.push(plan);
    byProposed.set(plan.proposedSku, list);
  }
  for (const [sku, group] of byProposed) {
    const names = new Set(group.map((plan) => plan.nameKey));
    if (names.size < 2) continue;
    for (const plan of group) {
      plan.blocked = true;
      pushException(exceptions, {
        action: "COLLISION",
        family: "fabric",
        name: plan.displayName,
        nameKey: plan.nameKey,
        currentSku: plan.katana?.sku ?? "",
        proposedSku: sku,
        quantity: plan.stockEligible ? formatQty(plan.available) : "",
        forCustomer: formatQty(plan.reserved),
        detail: `Proposed SKU ${sku} is shared by ${[...names].join(", ")}`,
      });
    }
  }

  for (const plan of plans) {
    if (plan.blocked || !plan.proposedSku) continue;
    if (ownedBySomeoneElse(skuOwners, plan.proposedSku, plan.nameKey)) {
      plan.blocked = true;
      const owner = skuOwners.get(plan.proposedSku);
      pushException(exceptions, {
        action: "COLLISION",
        family: "fabric",
        name: plan.displayName,
        nameKey: plan.nameKey,
        currentSku: plan.katana?.sku ?? "",
        proposedSku: plan.proposedSku,
        quantity: plan.stockEligible ? formatQty(plan.available) : "",
        forCustomer: formatQty(plan.reserved),
        detail: `Proposed SKU ${plan.proposedSku} already belongs to ${owner?.nameKey ?? "another row"}`,
      });
    }
  }

  for (const plan of plans) {
    if (plan.blocked || !plan.proposedSku) continue;
    const katana = plan.katana;
    const skuChanged = !katana || katana.sku !== plan.proposedSku;

    const physical = roundQty(plan.available + plan.reserved);

    if (!katana) {
      if (!plan.stockEligible) continue;
      creates.push({
        family: "fabric",
        materialName: plan.displayName,
        sku: plan.proposedSku,
        supplierItemCode: plan.supplierItemCode,
        category: "Fabric",
        uom: "yd",
        defaultSupplier: "",
        inStock: physical,
      });
    } else if (plan.supplierItemCode) {
      materials.push({
        family: "fabric",
        skuChanged,
        katanaId: katana.katanaId,
        materialName: katana.name,
        sku: plan.proposedSku,
        supplierItemCode: plan.supplierItemCode,
        category: katana.category || "Fabric",
        uom: katana.uom || "yd",
        defaultSupplier: katana.supplier,
      });
    } else if (skuChanged) {
      pushException(exceptions, {
        action: "UNMAPPED",
        family: "fabric",
        name: katana.name,
        nameKey: plan.nameKey,
        currentSku: katana.sku,
        proposedSku: plan.proposedSku,
        quantity: plan.stockEligible ? formatQty(plan.available) : "",
        forCustomer: formatQty(plan.reserved),
        detail: "Refusing to rename without a supplier item code, because a blank supplier item code wipes barcodes",
      });
      continue;
    }

    if (plan.stockEligible && katana) {
      stock.push({
        family: "fabric",
        materialName: katana.name,
        sku: plan.proposedSku,
        inStock: physical,
        location: katana.location || LOCATION,
      });
    }

    if (plan.stockEligible && plan.reserved > 0) {
      pushException(exceptions, {
        action: "FOR_CUSTOMER_HOLD",
        family: "fabric",
        name: katana?.name ?? plan.displayName,
        nameKey: plan.nameKey,
        currentSku: katana?.sku ?? "",
        proposedSku: plan.proposedSku,
        quantity: formatQty(plan.available),
        forCustomer: formatQty(plan.reserved),
        detail: "Reserved yards stay out of In stock. The physical sheet still records this hold.",
      });
    }
  }
}

function resolveDektonSku(
  key: string,
  typeKey: string,
  suffix: string,
  dektonByName: Map<string, KatanaItem[]>,
  bySku: Map<string, KatanaItem>,
  aliases: Map<string, string>,
): { item: KatanaItem } | { error: string } {
  const byName = dektonByName.get(key) ?? [];
  if (byName.length > 1) {
    return { error: `More than one Katana dekton row is named ${key}` };
  }
  if (byName.length === 1) return { item: byName[0]! };

  let canonical = aliases.get(key) ?? null;
  if (!canonical) {
    const bare = aliases.get(typeKey);
    if (bare?.endsWith(suffix)) canonical = bare;
  }
  if (!canonical) return { error: `No STN-DKT- row or alias for ${key}` };
  const item = bySku.get(canonical);
  if (!item || familyOf(item) !== "dekton") {
    return { error: `Alias ${key} → ${canonical} is not in the Katana export` };
  }
  return { item };
}

function reconcileDekton(
  rows: Record<string, string>[],
  dektonByName: Map<string, KatanaItem[]>,
  bySku: Map<string, KatanaItem>,
  stock: StockRow[],
  exceptions: ExceptionRow[],
  matched: Set<string>,
): void {
  type Group = {
    key: string;
    typeKey: string;
    suffix: string;
    display: string;
    qty: number;
    broken: boolean;
  };

  const groups = new Map<string, Group>();
  const aliases = dektonAliasMap();

  for (const row of rows) {
    const type = col(row, "TYPE");
    const qtyText = col(row, "QTY");
    const thickText = col(row, "THICKNESS");
    const location = col(row, "LOCATION");
    if (!type && !qtyText && !thickText) continue;

    const suffix = thickSuffix(thickText);
    const qty = num(qtyText);
    const typeKey = norm(type);
    const key = suffix ? `${typeKey} ${suffix}` : typeKey || "(blank)";
    const group = groups.get(key) ?? {
      key,
      typeKey,
      suffix: suffix ?? "",
      display: type.trim() || "(blank)",
      qty: 0,
      broken: false,
    };

    if (!type || !suffix || Number.isNaN(qty) || qty < 0) {
      group.broken = true;
      pushException(exceptions, {
        action: "MALFORMED",
        family: "dekton",
        name: type.trim() || "(blank)",
        nameKey: key,
        currentSku: "",
        proposedSku: "",
        quantity: qtyText,
        forCustomer: "",
        detail: `location ${location || "—"}: bad type, thickness, or quantity (thickness=${thickText || "—"}, qty=${qtyText || "—"})`,
      });
    } else {
      group.qty = roundQty(group.qty + qty);
    }
    groups.set(key, group);
  }

  type Resolved = { group: Group; item: KatanaItem };
  const resolved: Resolved[] = [];

  for (const group of groups.values()) {
    if (!group.suffix) continue;
    const hit = resolveDektonSku(group.key, group.typeKey, group.suffix, dektonByName, bySku, aliases);
    if ("error" in hit) {
      pushException(exceptions, {
        action: hit.error.startsWith("More than one") ? "COLLISION" : "UNMAPPED",
        family: "dekton",
        name: `${group.display} ${group.suffix}`,
        nameKey: group.key,
        currentSku: "",
        proposedSku: "",
        quantity: group.broken ? "" : formatQty(group.qty),
        forCustomer: "",
        detail: hit.error,
      });
      continue;
    }
    if (hit.item.sku) matched.add(hit.item.sku);
    if (group.broken) continue;
    resolved.push({ group, item: hit.item });
  }

  const byTarget = new Map<string, Resolved[]>();
  for (const row of resolved) {
    const list = byTarget.get(row.item.sku) ?? [];
    list.push(row);
    byTarget.set(row.item.sku, list);
  }

  for (const [sku, list] of byTarget) {
    const item = list[0]!.item;
    const qty = roundQty(list.reduce((sum, row) => sum + row.group.qty, 0));
    if (list.length > 1) {
      pushException(exceptions, {
        action: "REVIEW",
        family: "dekton",
        name: item.name,
        nameKey: norm(item.name),
        currentSku: sku,
        proposedSku: sku,
        quantity: formatQty(qty),
        forCustomer: "",
        detail: `Merged sheet keys ${list.map((row) => row.group.key).join(", ")} onto ${sku}`,
      });
    }
    stock.push({
      family: "dekton",
      materialName: item.name,
      sku,
      inStock: qty,
      location: item.location || LOCATION,
    });
  }
}

function reconcileFirepits(
  rows: Record<string, string>[],
  bySku: Map<string, KatanaItem>,
  materials: MaterialRow[],
  stock: StockRow[],
  creates: CreateRow[],
  exceptions: ExceptionRow[],
  matched: Set<string>,
): void {
  type Parsed = {
    code: string;
    description: string;
    vendor: string;
    category: string;
    qty: number;
    sku: string;
  };

  const parsed: Parsed[] = [];
  const byHubSku = new Map<string, Parsed[]>();

  for (const row of rows) {
    const code = col(row, "Code");
    const description = col(row, "Description");
    const vendor = col(row, "Vendor");
    const category = col(row, "Category");
    const qtyText = col(row, "Total on Hand");
    if (!code && !description && !qtyText) continue;

    const qty = num(qtyText);
    if (!code || Number.isNaN(qty) || qty < 0) {
      pushException(exceptions, {
        action: "MALFORMED",
        family: "firepit",
        name: description || code || "(blank)",
        nameKey: norm(description || code),
        currentSku: "",
        proposedSku: "",
        quantity: qtyText,
        forCustomer: "",
        detail: !code
          ? "Firepit row has no vendor code"
          : `Bad Total on Hand (${qtyText || "—"})`,
      });
      continue;
    }

    const sku = firepitSku(code);
    if (!sku || sku.length > 64) {
      pushException(exceptions, {
        action: "MALFORMED",
        family: "firepit",
        name: description || code,
        nameKey: norm(code),
        currentSku: "",
        proposedSku: sku ?? "",
        quantity: formatQty(qty),
        forCustomer: "",
        detail: sku ? `Hub SKU is ${sku.length} characters` : "Vendor code has no letters or digits",
      });
      continue;
    }

    const item: Parsed = { code, description, vendor, category, qty, sku };
    parsed.push(item);
    const list = byHubSku.get(sku) ?? [];
    list.push(item);
    byHubSku.set(sku, list);
  }

  const descriptionCounts = new Map<string, number>();
  for (const item of parsed) {
    const key = norm(item.description || item.code);
    descriptionCounts.set(key, (descriptionCounts.get(key) ?? 0) + 1);
  }

  for (const [sku, list] of byHubSku) {
    if (list.length > 1) {
      for (const item of list) {
        pushException(exceptions, {
          action: "COLLISION",
          family: "firepit",
          name: item.description || item.code,
          nameKey: norm(item.code),
          currentSku: "",
          proposedSku: sku,
          quantity: formatQty(item.qty),
          forCustomer: "",
          detail: `Vendor codes ${list.map((row) => row.code).join(", ")} strip to the same Hub SKU`,
        });
      }
      continue;
    }

    const item = list[0]!;
    const existing = bySku.get(sku);
    if (existing && familyOf(existing) === "firepit") {
      matched.add(existing.sku);
      materials.push({
        family: "firepit",
        skuChanged: false,
        katanaId: existing.katanaId,
        materialName: existing.name,
        sku: existing.sku,
        supplierItemCode: item.code,
        category: existing.category || "Firepit",
        uom: existing.uom || "pcs",
        defaultSupplier: existing.supplier,
      });
      stock.push({
        family: "firepit",
        materialName: existing.name,
        sku: existing.sku,
        inStock: item.qty,
        location: existing.location || LOCATION,
      });
      continue;
    }

    if (existing) {
      pushException(exceptions, {
        action: "COLLISION",
        family: "firepit",
        name: item.description || item.code,
        nameKey: norm(item.code),
        currentSku: existing.sku,
        proposedSku: sku,
        quantity: formatQty(item.qty),
        forCustomer: "",
        detail: `${sku} is already ${existing.category || "another category"} (${existing.name})`,
      });
      continue;
    }

    const nameKey = norm(item.description || item.code);
    let materialName = (item.description || item.code).trim();
    if ((descriptionCounts.get(nameKey) ?? 0) > 1) {
      materialName = `${materialName} (${item.code})`;
      pushException(exceptions, {
        action: "REVIEW",
        family: "firepit",
        name: materialName,
        nameKey,
        currentSku: "",
        proposedSku: sku,
        quantity: formatQty(item.qty),
        forCustomer: "",
        detail: "Description is shared by more than one vendor code, so the code was appended to the material name",
      });
    }

    creates.push({
      family: "firepit",
      materialName,
      sku,
      supplierItemCode: item.code,
      category: firepitCategory(item.category),
      uom: "pcs",
      defaultSupplier: item.vendor || "HPC Fire Inspired",
      inStock: item.qty,
    });
  }
}

function flagUntouched(items: KatanaItem[], matched: Set<string>, exceptions: ExceptionRow[]): void {
  for (const item of items) {
    const family = familyOf(item);
    if (family === "other") continue;
    if (!item.sku || matched.has(item.sku)) continue;
    pushException(exceptions, {
      action: "LEAVE_UNTOUCHED",
      family,
      name: item.name,
      nameKey: item.nameKey,
      currentSku: item.sku,
      proposedSku: "",
      quantity: item.inStock,
      forCustomer: "",
      detail: "No row on the physical sheet. Stock was not changed.",
    });
  }
}

function distinctNames(rows: ExceptionRow[], action: ExceptionAction): number {
  return new Set(
    rows.filter((row) => row.action === action).map((row) => `${row.family}|${row.nameKey}`),
  ).size;
}

function sumStock(rows: StockRow[], family: Family): number {
  return roundQty(rows.filter((row) => row.family === family).reduce((sum, row) => sum + row.inStock, 0));
}

function sumCreates(rows: CreateRow[], family: "fabric" | "firepit"): number {
  return roundQty(rows.filter((row) => row.family === family).reduce((sum, row) => sum + row.inStock, 0));
}

function printSummary(
  materials: MaterialRow[],
  stock: StockRow[],
  creates: CreateRow[],
  exceptions: ExceptionRow[],
  ignored: number,
  write: boolean,
): void {
  const fabricRename = materials.filter((row) => row.family === "fabric" && row.skuChanged).length;
  const fabricSupplier = materials.filter((row) => row.family === "fabric" && !row.skuChanged).length;
  const lines: Array<[string, string, string, string]> = [
    ["fabric", "rename+supplier", String(fabricRename), "see stock row"],
    ["fabric", "supplier-only", String(fabricSupplier), "sku unchanged"],
    ["fabric", "stock", String(stock.filter((row) => row.family === "fabric").length), `${formatQty(sumStock(stock, "fabric"))} yd`],
    ["fabric", "create", String(creates.filter((row) => row.family === "fabric").length), `${formatQty(sumCreates(creates, "fabric"))} yd`],
    ["fabric", "untouched", String(exceptions.filter((row) => row.action === "LEAVE_UNTOUCHED" && row.family === "fabric").length), "not written"],
    ["dekton", "stock", String(stock.filter((row) => row.family === "dekton").length), `${formatQty(sumStock(stock, "dekton"))} slab`],
    ["dekton", "untouched", String(exceptions.filter((row) => row.action === "LEAVE_UNTOUCHED" && row.family === "dekton").length), "not written"],
    ["firepit", "update", String(stock.filter((row) => row.family === "firepit").length), `${formatQty(sumStock(stock, "firepit"))} pcs`],
    ["firepit", "create", String(creates.filter((row) => row.family === "firepit").length), `${formatQty(sumCreates(creates, "firepit"))} pcs`],
    ["firepit", "untouched", String(exceptions.filter((row) => row.action === "LEAVE_UNTOUCHED" && row.family === "firepit").length), "not written"],
    ["review", "balance-break", String(distinctNames(exceptions, "BALANCE_BREAK")), "names excluded from stock"],
    ["review", "unmapped", String(distinctNames(exceptions, "UNMAPPED")), "names"],
    ["review", "collision", String(distinctNames(exceptions, "COLLISION")), "names"],
    ["review", "malformed", String(exceptions.filter((row) => row.action === "MALFORMED").length), "rows"],
    ["review", "for-customer", String(exceptions.filter((row) => row.action === "FOR_CUSTOMER_HOLD").length), "holds"],
    ["review", "notes", String(exceptions.filter((row) => row.action === "REVIEW").length), "disambiguated or merged"],
    ["ignored", "other-categories", String(ignored), "metal powder packaging wood"],
  ];

  const header = `${"family".padEnd(10)} ${"action".padEnd(18)} ${"rows".padStart(6)}  quantity`;
  console.log(header);
  console.log("-".repeat(header.length + 24));
  for (const [family, action, rows, quantity] of lines) {
    console.log(`${family.padEnd(10)} ${action.padEnd(18)} ${rows.padStart(6)}  ${quantity}`);
  }

  const files: Array<[string, number]> = [
    ["katana-bulk-update-materials.csv", materials.length],
    ["pilot-test.csv", materials.filter((row) => row.materialName === "ASSEMBLE SAND" || row.sku === "FAB-ASS-SAN").length],
    ["katana-bulk-update-stock.csv", stock.length],
    ["katana-create-materials.csv", creates.length],
    ["cleanse-exceptions.csv", exceptions.length],
  ];
  console.log("");
  for (const [name, count] of files) {
    console.log(`${write ? "write" : "would write"}  ${String(count).padStart(4)}  data_migration/reports/${name}`);
  }

  const samples = exceptions
    .filter((row) => row.action !== "FOR_CUSTOMER_HOLD")
    .slice(0, 12);
  if (samples.length > 0) {
    console.log("");
    console.log("Exception sample:");
    for (const row of samples) {
      console.log(`  ${row.action}  ${row.family}  ${row.name}  ${row.detail}`);
    }
  }
}

function materialCsv(rows: MaterialRow[]): string[][] {
  return [...rows]
    .sort((a, b) => a.sku.localeCompare(b.sku) || a.materialName.localeCompare(b.materialName))
    .map((row) => [
      row.katanaId,
      row.materialName,
      row.sku,
      row.supplierItemCode,
      row.category,
      row.uom,
      "Yes",
      row.defaultSupplier,
    ]);
}

function stockCsv(rows: StockRow[]): string[][] {
  return [...rows]
    .sort((a, b) => a.family.localeCompare(b.family) || a.sku.localeCompare(b.sku))
    .map((row) => [row.materialName, row.sku, formatQty(row.inStock), row.location]);
}

function createCsv(rows: CreateRow[]): string[][] {
  return [...rows]
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .map((row) => [
      row.materialName,
      row.sku,
      row.supplierItemCode,
      row.category,
      row.uom,
      "Yes",
      row.defaultSupplier,
      formatQty(row.inStock),
    ]);
}

function exceptionCsv(rows: ExceptionRow[]): string[][] {
  return [...rows]
    .sort(
      (a, b) =>
        a.action.localeCompare(b.action) ||
        a.family.localeCompare(b.family) ||
        a.name.localeCompare(b.name),
    )
    .map((row) => [
      row.action,
      row.family,
      row.name,
      row.currentSku,
      row.proposedSku,
      row.quantity,
      row.forCustomer,
      row.detail,
    ]);
}

function assertImportable(materials: MaterialRow[], stock: StockRow[], creates: CreateRow[]): void {
  for (const row of materials) {
    if (!row.katanaId || !row.materialName || !row.sku || !row.supplierItemCode) {
      throw new Error(`Materials row ${row.sku || row.materialName} is missing a Katana ID, name, SKU, or supplier item code`);
    }
  }
  for (const row of stock) {
    if (!row.materialName || !row.sku || !row.location) {
      throw new Error(`Stock row ${row.sku || row.materialName} is missing a name, SKU, or location`);
    }
  }
  for (const row of creates) {
    if (!row.materialName || !row.sku) {
      throw new Error("Create row is missing a material name or SKU");
    }
    if (row.family === "firepit" && !row.supplierItemCode) {
      throw new Error(`Firepit create ${row.sku} is missing a supplier item code`);
    }
  }
}

function main(): void {
  const write = process.argv.includes("--write") && !process.argv.includes("--dry-run");
  if (process.argv.includes("--write") && process.argv.includes("--dry-run")) {
    console.log("Both --dry-run and --write were passed. Dry-run wins; no files written.");
  }

  const katanaPath = join(DATA_DIR, "Update existing materials.csv");
  const fabricPath = findCsv("Fabric");
  const dektonPath = findCsv("DEKTON");
  const firepitPath = findCsv("FIREPIT");

  const katana = loadKatana(katanaPath);
  const dictionary = loadFabricDictionary(DICTIONARY_PATH);
  const fabricBins = parseFabricBins(
    readSheet(fabricPath, "FABRIC", [
      "FABRIC",
      "SKU NUMBER",
      "TOTAL ENTRIES",
      "TOTAL OUTPUTS",
      "FOR CUSTOMER",
      "STOCK AVAILABLE",
    ]),
  );
  const dektonRows = readSheet(dektonPath, "THICKNESS", ["LOCATION", "TYPE", "QTY", "THICKNESS"]);
  const firepitRows = readSheet(firepitPath, "Total on Hand", [
    "Vendor",
    "Category",
    "Code",
    "Description",
    "Total on Hand",
  ]);

  const materials: MaterialRow[] = [];
  const stock: StockRow[] = [];
  const creates: CreateRow[] = [];
  const exceptions: ExceptionRow[] = [];
  const matched = new Set<string>();

  reconcileFabrics(
    fabricBins,
    katana.fabricByName,
    dictionary.byName,
    dictionary.ambiguous,
    katana.skuOwners,
    materials,
    stock,
    creates,
    exceptions,
    matched,
  );
  reconcileDekton(dektonRows, katana.dektonByName, katana.bySku, stock, exceptions, matched);
  reconcileFirepits(
    firepitRows,
    katana.bySku,
    materials,
    stock,
    creates,
    exceptions,
    matched,
  );
  flagUntouched(katana.items, matched, exceptions);
  assertImportable(materials, stock, creates);

  console.log(write ? "Writing Katana cleanse CSVs" : "Dry run. Pass --write to write data_migration/reports/.");
  console.log("");
  printSummary(materials, stock, creates, exceptions, katana.ignored, write);

  if (!write) return;

  mkdirSync(REPORT_DIR, { recursive: true });
  const materialRows = materialCsv(materials);
  const outputs: Array<[string, string]> = [
    ["katana-bulk-update-materials.csv", toCsv(MATERIALS_HEADERS, materialRows)],
    ["katana-bulk-update-stock.csv", toCsv(STOCK_HEADERS, stockCsv(stock))],
    ["katana-create-materials.csv", toCsv(CREATE_HEADERS, createCsv(creates))],
    ["cleanse-exceptions.csv", toCsv(EXCEPTION_HEADERS, exceptionCsv(exceptions))],
  ];
  for (const [name, body] of outputs) {
    writeFileSync(join(REPORT_DIR, name), body, "utf8");
  }

  const pilotRows = materialRows.filter(
    (row) => row[1] === "ASSEMBLE SAND" || row[2] === "FAB-ASS-SAN",
  );
  if (pilotRows.length !== 1) {
    throw new Error(
      `Pilot row ASSEMBLE SAND / FAB-ASS-SAN matched ${pilotRows.length} materials rows`,
    );
  }
  writeFileSync(
    join(REPORT_DIR, "pilot-test.csv"),
    toCsv(MATERIALS_HEADERS, pilotRows),
    "utf8",
  );
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

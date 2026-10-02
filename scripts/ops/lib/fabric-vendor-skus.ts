/**
 * Manufacturer style numbers from the fabric-needs sheet.
 * Blank SKU rows are skipped. The same fabric with two different style
 * numbers is a conflict and is not written.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsvLine } from "./csv";

export const FABRIC_NEEDS_CSV = join(
  process.cwd(),
  "data_migration",
  "CURRENT Fabric Control Inventory 2026-CURRENT.xlsx - FABRIC NEEDS.csv",
);

export type FabricVendorAssignment = {
  fabric: string;
  vendorSku: string;
  rowCount: number;
};

export type FabricVendorConflict = {
  fabric: string;
  vendorSkus: string[];
  rowCount: number;
};

export type FabricVendorPlan = {
  assignments: FabricVendorAssignment[];
  conflicts: FabricVendorConflict[];
  blankRows: number;
};

function headerIndex(lines: string[]): number {
  const scan = Math.min(lines.length, 5);
  for (let index = 0; index < scan; index += 1) {
    const headers = parseCsvLine(lines[index]!).map((header) => header.trim().toLowerCase());
    if (headers.includes("fabric") && headers.includes("sku")) return index;
  }
  return -1;
}

export function readFabricNeedRows(
  path = FABRIC_NEEDS_CSV,
): Array<{ fabric: string; vendorSku: string }> {
  const raw = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headerAt = headerIndex(lines);
  if (headerAt < 0 || headerAt >= lines.length - 1) {
    throw new Error(`FABRIC and SKU columns are required in ${path}.`);
  }
  const headers = parseCsvLine(lines[headerAt]!).map((header) => header.trim().toLowerCase());
  const fabricIndex = headers.indexOf("fabric");
  const skuIndex = headers.indexOf("sku");
  return lines.slice(headerAt + 1).map((line) => {
    const cols = parseCsvLine(line);
    return {
      fabric: (cols[fabricIndex] ?? "").trim(),
      vendorSku: (cols[skuIndex] ?? "").trim(),
    };
  });
}

export function planFabricVendorSkus(
  rows: ReadonlyArray<{ fabric: string; vendorSku: string }>,
): FabricVendorPlan {
  const groups = new Map<
    string,
    { fabric: string; skus: Map<string, string>; rowCount: number }
  >();
  let blankRows = 0;
  for (const row of rows) {
    const fabric = row.fabric.trim();
    const vendorSku = row.vendorSku.trim();
    if (!fabric || !vendorSku) {
      blankRows += 1;
      continue;
    }
    const key = fabric.toLowerCase();
    const group = groups.get(key) ?? { fabric, skus: new Map<string, string>(), rowCount: 0 };
    group.rowCount += 1;
    group.skus.set(vendorSku.toLowerCase(), vendorSku);
    groups.set(key, group);
  }

  const assignments: FabricVendorAssignment[] = [];
  const conflicts: FabricVendorConflict[] = [];
  for (const group of groups.values()) {
    const vendorSkus = [...group.skus.values()].sort((left, right) => left.localeCompare(right));
    if (vendorSkus.length === 1) {
      assignments.push({
        fabric: group.fabric,
        vendorSku: vendorSkus[0]!,
        rowCount: group.rowCount,
      });
      continue;
    }
    conflicts.push({ fabric: group.fabric, vendorSkus, rowCount: group.rowCount });
  }
  assignments.sort((left, right) => left.fabric.localeCompare(right.fabric));
  conflicts.sort((left, right) => left.fabric.localeCompare(right.fabric));
  return { assignments, conflicts, blankRows };
}

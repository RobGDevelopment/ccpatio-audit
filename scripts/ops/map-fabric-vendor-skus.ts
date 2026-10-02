/**
 * Copy manufacturer style numbers onto Katana fabric variants.
 *
 * The website and factory SKU (FAB-CAN-NAV) is not changed. The CSV SKU
 * (5439-0000) is written to supplier_item_codes, which is what purchase
 * orders show. Duplicate sheet rows that agree are one write. A fabric
 * name with two different style numbers is skipped.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/map-fabric-vendor-skus.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/map-fabric-vendor-skus.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import {
  KatanaApiError,
  createIntervalPacer,
  katanaFetch,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import { normalizeStockCategory } from "../../src/lib/stock-categories";
import {
  planFabricVendorSkus,
  readFabricNeedRows,
  type FabricVendorAssignment,
} from "./lib/fabric-vendor-skus";
import { unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const confirm = process.argv.includes("--confirm") && !process.argv.includes("--dry-run");
const PAGE_SIZE = 250;
const MAX_PAGES = 40;

setKatanaRequestPacer(createIntervalPacer(350));

type FabricVariant = {
  id: number;
  sku: string;
  materialName: string;
  codes: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function katanaError(error: unknown): string {
  if (error instanceof KatanaApiError) {
    const details = error.details ? ` ${JSON.stringify(error.details)}` : "";
    return `${error.message}${details}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function supplierCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      codes.push(item.trim());
      continue;
    }
    const record = asRecord(item);
    const code = record?.supplier_item_code ?? record?.code;
    if (typeof code === "string" && code.trim()) codes.push(code.trim());
  }
  return codes;
}

async function paginate(path: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(`${path}${sep}limit=${PAGE_SIZE}&page=${page}`);
    const pageRows = unwrapList<Record<string, unknown>>(data);
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return rows;
  }
  throw new Error(`${path} did not finish within ${MAX_PAGES} pages.`);
}

function indexFabrics(materials: Record<string, unknown>[]): Map<string, FabricVariant[]> {
  const index = new Map<string, FabricVariant[]>();
  for (const material of materials) {
    if (material.deleted_at) continue;
    const category = normalizeStockCategory(String(material.category_name ?? ""));
    if (category !== "Fabric") continue;
    const name = String(material.name ?? "").trim();
    if (!name) continue;
    const variants = Array.isArray(material.variants) ? material.variants : [];
    const hits: FabricVariant[] = [];
    for (const variant of variants) {
      const record = asRecord(variant);
      if (!record || record.deleted_at) continue;
      const id = Number(record.id);
      const sku = String(record.sku ?? "").trim().toUpperCase();
      if (!Number.isFinite(id) || id <= 0 || !sku) continue;
      hits.push({
        id,
        sku,
        materialName: name,
        codes: supplierCodes(record.supplier_item_codes),
      });
    }
    if (hits.length === 0) continue;
    const key = name.toLowerCase();
    const list = index.get(key) ?? [];
    list.push(...hits);
    index.set(key, list);
  }
  return index;
}

function sameCode(current: string[], vendorSku: string): boolean {
  return current.length === 1 && current[0]!.toLowerCase() === vendorSku.toLowerCase();
}

async function applyAssignment(
  assignment: FabricVendorAssignment,
  variant: FabricVariant,
): Promise<"patched" | "unchanged"> {
  if (sameCode(variant.codes, assignment.vendorSku)) return "unchanged";
  const previous = variant.codes.length > 0 ? variant.codes.join(", ") : "(none)";
  console.log(
    `  PATCH /variants/${variant.id} ${variant.sku} supplier_item_codes ${previous} → ${assignment.vendorSku}`,
  );
  if (!confirm) return "patched";
  await katanaFetch(`/variants/${variant.id}`, {
    method: "PATCH",
    body: { supplier_item_codes: [assignment.vendorSku] },
  });
  return "patched";
}

async function main(): Promise<void> {
  const rows = readFabricNeedRows();
  const plan = planFabricVendorSkus(rows);
  console.log("Fabric vendor SKU map");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);
  console.log(`  sheet rows: ${rows.length}`);
  console.log(`  blank fabric or SKU rows: ${plan.blankRows}`);
  console.log(`  unique fabrics: ${plan.assignments.length}`);
  console.log(`  conflicting fabrics: ${plan.conflicts.length}`);
  for (const conflict of plan.conflicts) {
    console.log(
      `  conflict ${conflict.fabric} (${conflict.rowCount} rows): ${conflict.vendorSkus.join(" | ")}`,
    );
  }

  const materials = await paginate("/materials");
  const fabrics = indexFabrics(materials);
  console.log(`  katana fabric variants indexed: ${[...fabrics.values()].reduce((sum, list) => sum + list.length, 0)}`);

  let patched = 0;
  let unchanged = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let failed = 0;

  for (const assignment of plan.assignments) {
    const hits = fabrics.get(assignment.fabric.toLowerCase()) ?? [];
    if (hits.length === 0) {
      unmatched += 1;
      console.log(`  no Fabric variant named "${assignment.fabric}" for ${assignment.vendorSku}`);
      continue;
    }
    if (hits.length > 1) {
      ambiguous += 1;
      console.log(
        `  skip ${assignment.fabric}: ${hits.length} Fabric variants (${hits.map((hit) => hit.sku).join(", ")})`,
      );
      continue;
    }
    try {
      const result = await applyAssignment(assignment, hits[0]!);
      if (result === "patched") patched += 1;
      else unchanged += 1;
    } catch (error: unknown) {
      failed += 1;
      console.error(`  failed ${assignment.fabric} (${assignment.vendorSku}): ${katanaError(error)}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  ${confirm ? "patched" : "would patch"}: ${patched}`);
  console.log(`  already set:    ${unchanged}`);
  console.log(`  unmatched:      ${unmatched}`);
  console.log(`  ambiguous:      ${ambiguous}`);
  console.log(`  conflicts:      ${plan.conflicts.length}`);
  console.log(`  failed:         ${failed}`);
  if (!confirm) console.log("  Re-run with --confirm to PATCH Katana. Internal SKUs are not changed.");
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(katanaError(error));
  process.exitCode = 1;
});

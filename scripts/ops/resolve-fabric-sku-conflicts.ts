/**
 * Write the corrected manufacturer style numbers for fabrics the sheet
 * listed under more than one SKU. Internal fabric SKUs of existing
 * variants are not changed. A name with no Fabric variant is created as
 * a Katana material (category Fabric, uom yd) and then patched.
 * Katana purchase orders read supplier_item_codes.
 *
 *   npx dotenv -e .env.local -- tsx scripts/ops/resolve-fabric-sku-conflicts.ts
 *   npx dotenv -e .env.local -- tsx scripts/ops/resolve-fabric-sku-conflicts.ts --confirm
 */
import { loadEnvConfig } from "@next/env";
import {
  KatanaApiError,
  createIntervalPacer,
  katanaFetch,
  resolveLiveKatanaApiBase,
  setKatanaRequestPacer,
} from "../../src/lib/katana";
import { normalizeStockCategory } from "../../src/lib/stock-categories";
import { unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const CORRECTED_SKUS: Record<string, string> = {
  "Berenson Tuxedo": "8521-0000",
  "Cabana Classic": "58030-0000",
  "Canvas Black": "5408-0000",
  "Canvas Camel": "5468-0000",
  "Canvas Fern": "5487-0000",
  "Canvas Flax": "5492-0000",
  "Canvas Haze": "14059-0054",
  "Canvas Heather Beige": "5476-0000",
  "Canvas Taupe": "5461-0000",
  "Canvas White": "57003-0000",
  "Cast Slate": "40434-0000",
  "Coast Savanna": "640-3880",
  "Dumont Stucco": "305825-0002",
  "Escape Denim": "146207-0001",
  "Heritage Char": "18009-0000",
  "Improve White": "17003-0001",
  "Leaf Structure Cloud": "146419-0001",
  "Lido Indigo": "57004-0000",
  "Linen Silver": "8351-0000",
  "Metamorphic Sand": "46094-0002",
  "Nurture Pebble": "42102-0002",
  "Posh Sky": "44157-0052",
  "Revive Sand": "11500-0003",
  "Shore Classic": "58033-0000",
  "Shore Linen": "56054-0000",
  "Solve Denim": "146397-0001",
  "Spectrum Cayenne": "48026-0000",
  "Spectrum Indigo": "48080-0000",
  "Stanton Lagoon": "58001-0000",
};

const confirm = process.argv.includes("--confirm") && !process.argv.includes("--dry-run");
const PAGE_SIZE = 250;
const MAX_PAGES = 40;

setKatanaRequestPacer(createIntervalPacer(350));

const liveBase = resolveLiveKatanaApiBase();

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
    const { data } = await katanaFetch(`${path}${sep}limit=${PAGE_SIZE}&page=${page}`, {
      baseUrl: liveBase,
    });
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

function abbreviate(word: string): string {
  const letters = word.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return letters.slice(0, 3);
}

function proposeFabricSku(name: string, taken: Set<string>): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const head = abbreviate(words[0] ?? "FAB") || "FAB";
  const tail = words.slice(1).map(abbreviate).join("") || "MAT";
  const base = `FAB-${head}-${tail}`.slice(0, 40);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`No free SKU for ${name}.`);
}

function takenSkus(materials: Record<string, unknown>[]): Set<string> {
  const taken = new Set<string>();
  for (const material of materials) {
    const variants = Array.isArray(material.variants) ? material.variants : [];
    for (const variant of variants) {
      const record = asRecord(variant);
      const sku = String(record?.sku ?? "").trim().toUpperCase();
      if (sku) taken.add(sku);
    }
  }
  return taken;
}

function createdVariant(data: unknown): { id: number; sku: string } | null {
  const record = asRecord(data) ?? {};
  const body = asRecord(record.data) ?? record;
  const variants = Array.isArray(body.variants) ? body.variants : [];
  const variant = asRecord(variants[0]);
  const id = Number(variant?.id);
  const sku = String(variant?.sku ?? "").trim().toUpperCase();
  if (!Number.isFinite(id) || id <= 0 || !sku) return null;
  return { id, sku };
}

async function postMaterial(body: Record<string, unknown>): Promise<unknown> {
  const created = await katanaFetch("/materials", {
    method: "POST",
    baseUrl: liveBase,
    body,
  });
  return created.data;
}

async function createFabricMaterial(
  name: string,
  vendorSku: string,
  taken: Set<string>,
): Promise<FabricVariant> {
  const sku = proposeFabricSku(name, taken);
  // POST /materials creates a material. Katana rejects an is_material field.
  let data: unknown;
  try {
    data = await postMaterial({
      name,
      uom: "yd",
      category_name: "Fabric",
      is_sellable: false,
      variants: [{ sku, supplier_item_codes: [vendorSku] }],
    });
  } catch (error: unknown) {
    if (!(error instanceof KatanaApiError) || error.status !== 422) throw error;
    data = await postMaterial({
      name,
      uom: "yd",
      category_name: "Fabric",
      is_sellable: false,
      variants: [{ sku }],
    });
  }
  const variant = createdVariant(data);
  if (!variant) {
    throw new Error(`Katana created ${name} but returned no variant id.`);
  }
  taken.add(variant.sku);
  await katanaFetch(`/variants/${variant.id}`, {
    method: "PATCH",
    baseUrl: liveBase,
    body: { supplier_item_codes: [vendorSku] },
  });
  return {
    id: variant.id,
    sku: variant.sku,
    materialName: name,
    codes: [vendorSku],
  };
}

async function main(): Promise<void> {
  const entries = Object.entries(CORRECTED_SKUS);
  console.log("Resolve fabric SKU conflicts");
  console.log(`  mode: ${confirm ? "LIVE (--confirm)" : "DRY-RUN"}`);
  console.log(`  corrected fabrics: ${entries.length}`);

  const materials = await paginate("/materials");
  const fabrics = indexFabrics(materials);
  const taken = takenSkus(materials);
  console.log(
    `  katana fabric variants indexed: ${[...fabrics.values()].reduce((sum, list) => sum + list.length, 0)}`,
  );

  let patched = 0;
  let created = 0;
  let unchanged = 0;
  let ambiguous = 0;
  let failed = 0;

  for (const [fabric, vendorSku] of entries) {
    const hits = fabrics.get(fabric.toLowerCase()) ?? [];
    if (hits.length === 0) {
      console.log(`  create Fabric material "${fabric}" supplier_item_codes ${vendorSku}`);
      if (!confirm) {
        created += 1;
        continue;
      }
      try {
        const variant = await createFabricMaterial(fabric, vendorSku, taken);
        created += 1;
        console.log(`  created ${variant.sku} variant ${variant.id} ${fabric}`);
      } catch (error: unknown) {
        failed += 1;
        console.error(`  failed to create ${fabric} (${vendorSku}): ${katanaError(error)}`);
      }
      continue;
    }
    if (hits.length > 1) {
      ambiguous += 1;
      console.log(
        `  skip ${fabric}: ${hits.length} Fabric variants (${hits.map((hit) => hit.sku).join(", ")})`,
      );
      continue;
    }
    const variant = hits[0]!;
    if (sameCode(variant.codes, vendorSku)) {
      unchanged += 1;
      console.log(`  already set ${variant.sku} ${fabric} supplier_item_codes ${vendorSku}`);
      continue;
    }
    const previous = variant.codes.length > 0 ? variant.codes.join(", ") : "(none)";
    console.log(
      `  PATCH /variants/${variant.id} ${variant.sku} supplier_item_codes ${previous} → ${vendorSku}`,
    );
    if (!confirm) {
      patched += 1;
      continue;
    }
    try {
      await katanaFetch(`/variants/${variant.id}`, {
        method: "PATCH",
        baseUrl: liveBase,
        body: { supplier_item_codes: [vendorSku] },
      });
      patched += 1;
    } catch (error: unknown) {
      failed += 1;
      console.error(`  failed ${fabric} (${vendorSku}): ${katanaError(error)}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`  ${confirm ? "patched" : "would patch"}: ${patched}`);
  console.log(`  ${confirm ? "created" : "would create"}: ${created}`);
  console.log(`  already set:    ${unchanged}`);
  console.log(`  ambiguous:      ${ambiguous}`);
  console.log(`  failed:         ${failed}`);
  if (!confirm) {
    console.log("  Re-run with --confirm to PATCH or create Katana materials.");
  }
  if (failed > 0 || ambiguous > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(katanaError(error));
  process.exitCode = 1;
});

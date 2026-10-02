/**
 * Audit Katana's material catalog against Phase 1 & 2 recipe ingredients.
 *
 * Why this exists: Katana's bulk "Add new recipes" importer 422s on missing
 * ingredient SKUs. We need a single pass that lists every unique ingredient
 * from docs/Katana Downloads/Add-new-recipes.csv, diffs it against live
 * Katana variants/materials, and infers UoM for the next POST /materials step.
 *
 * This script is audit-only. It never POST/PATCH/DELETE.
 *
 *   npm run ops:katana-material-sync
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { katanaFetch } from "../../src/lib/katana";
import {
  inferMaterialUom,
} from "../../src/lib/katana-material-uom";
import {
  isHubRawMaterialSku,
  isHubSubAssemblySku,
} from "../../src/lib/raw-material-sku";
import {
  REQUEST_DELAY_MS,
  col,
  delay,
  readCsvRecords,
  unwrapList,
} from "./lib/csv";

loadEnvConfig(process.cwd());

const PAGE_SIZE = 250;
const MAX_PAGES = 200;

const RECIPES_CSV = join(
  process.cwd(),
  "docs",
  "Katana Downloads",
  "Add-new-recipes.csv",
);

type KatanaVariant = {
  id: number;
  sku: string | null;
  type?: string | null;
  product_id?: number | null;
  material_id?: number | null;
  deleted_at?: string | null;
};

type KatanaMaterial = {
  id: number;
  name?: string | null;
  is_archived?: boolean | null;
  archived_at?: string | null;
  variants?: KatanaVariant[] | null;
};

type IngredientReq = {
  sku: string;
  name: string;
};

type AuditRow = {
  status: "missing" | "ok" | "duplicate";
  sku: string;
  ingredient_name: string;
  kind: "material" | "sub_assembly" | "finished_good" | "unknown";
  inferred_uom: string;
  katana_uom: string;
  uom_rule: string;
  variant_count: number;
  variant_ids: string;
  material_ids: string;
  variant_types: string;
  post_candidate: "yes" | "no";
  note: string;
};

function normalizeSku(raw: string): string {
  return raw.trim().toUpperCase();
}

function classifyKind(
  sku: string,
): AuditRow["kind"] {
  if (isHubRawMaterialSku(sku)) return "material";
  if (isHubSubAssemblySku(sku)) return "sub_assembly";
  if (sku.startsWith("FIN-")) return "finished_good";
  return "unknown";
}

function loadIngredientRequirements(): IngredientReq[] {
  if (!existsSync(RECIPES_CSV)) {
    throw new Error(`Missing recipe import file: ${RECIPES_CSV}`);
  }
  const rows = readCsvRecords(RECIPES_CSV);
  const bySku = new Map<string, IngredientReq>();
  for (const row of rows) {
    const sku = normalizeSku(
      col(
        row,
        "Ingredient variant code / SKU (required)",
        "Ingredient variant code / SKU",
      ),
    );
    if (!sku) continue;
    if (bySku.has(sku)) continue;
    bySku.set(sku, {
      sku,
      name: col(row, "Ingredient variant name"),
    });
  }
  if (bySku.size === 0) {
    throw new Error(
      `No ingredient SKUs in ${RECIPES_CSV}. Expected column "Ingredient variant code / SKU (required)".`,
    );
  }
  return [...bySku.values()].sort((a, b) => a.sku.localeCompare(b.sku));
}

async function paginate<T>(pathBase: string, label: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = pathBase.includes("?") ? "&" : "?";
    const { data } = await katanaFetch(
      `${pathBase}${sep}limit=${PAGE_SIZE}&page=${page}`,
    );
    const rows = unwrapList<T>(data);
    all.push(...rows);
    console.log(`  ${label} page ${page}: ${rows.length}`);
    if (rows.length < PAGE_SIZE) return all;
    await delay(REQUEST_DELAY_MS);
  }
  throw new Error(
    `Pagination hit ${MAX_PAGES} full pages for ${label} (${all.length} rows). Aborting so a partial list cannot be treated as complete.`,
  );
}

function writeCsv(path: string, headers: string[], rows: string[][]): void {
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
    ),
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
}

function isArchivedMaterial(m: KatanaMaterial): boolean {
  if (m.is_archived === true) return true;
  return m.archived_at != null && String(m.archived_at).trim() !== "";
}

async function main(): Promise<void> {
  const ingredients = loadIngredientRequirements();
  const required = new Set(ingredients.map((i) => i.sku));

  console.log("Katana material catalog audit (Phase 1 & 2 ingredients)");
  console.log("  mode: AUDIT-ONLY (no POST/PATCH/DELETE)");
  console.log(`  recipes: ${RECIPES_CSV}`);
  console.log(`  unique ingredient SKUs: ${ingredients.length}`);
  console.log("");

  console.log("→ Fetching Katana /variants + /materials");
  const variants = await paginate<KatanaVariant>(
    "/variants?include_deleted=false",
    "variants",
  );
  await delay(REQUEST_DELAY_MS);
  const materials = await paginate<KatanaMaterial>(
    "/materials?include_deleted=false",
    "materials",
  );

  const liveMaterials = materials.filter((m) => !isArchivedMaterial(m));
  const variantsBySku = new Map<string, KatanaVariant[]>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(v.sku ?? "");
    if (!sku || !Number.isFinite(v.id)) continue;
    const list = variantsBySku.get(sku) ?? [];
    list.push(v);
    variantsBySku.set(sku, list);
  }

  const materialIdsBySku = new Map<string, Set<number>>();
  for (const m of liveMaterials) {
    for (const v of m.variants ?? []) {
      const sku = normalizeSku(v.sku ?? "");
      if (!sku) continue;
      const ids = materialIdsBySku.get(sku) ?? new Set<number>();
      ids.add(m.id);
      materialIdsBySku.set(sku, ids);
    }
  }

  const audit: AuditRow[] = [];
  const seenDuplicateSkus = new Set<string>();

  for (const req of ingredients) {
    const hits = variantsBySku.get(req.sku) ?? [];
    const uom = inferMaterialUom(req.sku);
    const kind = classifyKind(req.sku);
    const materialIds = [
      ...new Set(
        [
          ...(materialIdsBySku.get(req.sku) ?? []),
          ...hits
            .map((h) => h.material_id)
            .filter((id): id is number => id != null && Number.isFinite(id)),
        ],
      ),
    ];
    const types = [
      ...new Set(hits.map((h) => (h.type ?? "").trim()).filter(Boolean)),
    ];

    if (hits.length === 0) {
      const post = kind === "material";
      audit.push({
        status: "missing",
        sku: req.sku,
        ingredient_name: req.name,
        kind,
        inferred_uom: uom.uom,
        katana_uom: uom.katanaUom,
        uom_rule: uom.rule,
        variant_count: 0,
        variant_ids: "",
        material_ids: "",
        variant_types: "",
        post_candidate: post ? "yes" : "no",
        note: post
          ? "required by BOM CSV; not in Katana — POST /materials next"
          : "required by BOM CSV; not a raw material — do not POST as material",
      });
      continue;
    }

    if (hits.length > 1) {
      seenDuplicateSkus.add(req.sku);
      audit.push({
        status: "duplicate",
        sku: req.sku,
        ingredient_name: req.name,
        kind,
        inferred_uom: uom.uom,
        katana_uom: uom.katanaUom,
        uom_rule: uom.rule,
        variant_count: hits.length,
        variant_ids: hits.map((h) => String(h.id)).join("|"),
        material_ids: materialIds.map(String).join("|"),
        variant_types: types.join("|"),
        post_candidate: "no",
        note: "same SKU on multiple Katana variants — importer may pick the wrong one",
      });
      continue;
    }

    audit.push({
      status: "ok",
      sku: req.sku,
      ingredient_name: req.name,
      kind,
      inferred_uom: uom.uom,
      katana_uom: uom.katanaUom,
      uom_rule: uom.rule,
      variant_count: 1,
      variant_ids: String(hits[0]!.id),
      material_ids: materialIds.map(String).join("|"),
      variant_types: types.join("|"),
      post_candidate: "no",
      note: "present in Katana",
    });
  }

  // Tenant-wide duplicate SKUs that are not in the recipe file still matter
  // if we are about to POST colliding names.
  const extraDuplicates: AuditRow[] = [];
  for (const [sku, hits] of variantsBySku) {
    if (hits.length < 2) continue;
    if (required.has(sku)) continue;
    const uom = inferMaterialUom(sku);
    extraDuplicates.push({
      status: "duplicate",
      sku,
      ingredient_name: "",
      kind: classifyKind(sku),
      inferred_uom: uom.uom,
      katana_uom: uom.katanaUom,
      uom_rule: uom.rule,
      variant_count: hits.length,
      variant_ids: hits.map((h) => String(h.id)).join("|"),
      material_ids: [...(materialIdsBySku.get(sku) ?? [])].map(String).join("|"),
      variant_types: [
        ...new Set(hits.map((h) => (h.type ?? "").trim()).filter(Boolean)),
      ].join("|"),
      post_candidate: "no",
      note: "duplicate SKU in Katana tenant (not an ingredient in this CSV)",
    });
  }
  extraDuplicates.sort((a, b) => a.sku.localeCompare(b.sku));
  audit.push(...extraDuplicates);

  const missingMaterials = audit.filter(
    (r) => r.status === "missing" && r.post_candidate === "yes",
  );
  const missingOther = audit.filter(
    (r) => r.status === "missing" && r.post_candidate === "no",
  );
  const duplicates = audit.filter((r) => r.status === "duplicate");
  const ok = audit.filter((r) => r.status === "ok");

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(outDir, `katana-material-audit-${stamp}.csv`);
  writeCsv(
    reportPath,
    [
      "status",
      "sku",
      "ingredient_name",
      "kind",
      "inferred_uom",
      "katana_uom",
      "uom_rule",
      "variant_count",
      "variant_ids",
      "material_ids",
      "variant_types",
      "post_candidate",
      "note",
    ],
    audit.map((r) => [
      r.status,
      r.sku,
      r.ingredient_name,
      r.kind,
      r.inferred_uom,
      r.katana_uom,
      r.uom_rule,
      String(r.variant_count),
      r.variant_ids,
      r.material_ids,
      r.variant_types,
      r.post_candidate,
      r.note,
    ]),
  );

  console.log(`\n→ Katana variants: ${variants.length}`);
  console.log(`  Katana materials (active): ${liveMaterials.length}`);
  console.log(`  unique SKUs on variants: ${variantsBySku.size}`);
  console.log(`  recipe ingredients present: ${ok.length}`);
  console.log(`  missing materials (POST candidates): ${missingMaterials.length}`);
  console.log(`  missing non-materials (ASM/SA/FIN/other): ${missingOther.length}`);
  console.log(`  duplicate SKUs (recipe + extra tenant): ${duplicates.length}`);
  console.log(`  CSV: ${reportPath}`);

  if (missingMaterials.length > 0) {
    console.log("\nMissing materials (first 40):");
    for (const row of missingMaterials.slice(0, 40)) {
      console.log(
        `  ${row.sku}  uom=${row.inferred_uom} (${row.katana_uom})  rule=${row.uom_rule}  ${row.ingredient_name}`,
      );
    }
    if (missingMaterials.length > 40) {
      console.log(`  … +${missingMaterials.length - 40} more`);
    }
  }

  if (duplicates.length > 0) {
    console.log("\nDuplicate SKUs (first 20):");
    for (const row of duplicates.slice(0, 20)) {
      console.log(
        `  ${row.sku}  variants=${row.variant_count}  ids=${row.variant_ids}`,
      );
    }
  }

  if (missingOther.length > 0) {
    console.log("\nMissing non-material ingredients (will also 422 the importer):");
    for (const row of missingOther.slice(0, 20)) {
      console.log(`  ${row.sku}  kind=${row.kind}`);
    }
    if (missingOther.length > 20) {
      console.log(`  … +${missingOther.length - 20} more`);
    }
  }

  console.log("\nAudit only. Next: POST missing materials (post_candidate=yes) to Katana.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

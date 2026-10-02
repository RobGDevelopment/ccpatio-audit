/**
 * PATCH-first remint of the 6 Hub materials still sitting as blank-SKU
 * factory placeholders. POST /materials only when the blank is already gone
 * and the RM-* SKU is missing.
 *
 * Targets (name → SKU → UoM via inferMaterialUom):
 *   Spacers           → RM-HRD-SPACERS        → pcs
 *   Umbrella Holder   → RM-HRD-UMBRELLA-HOLDER → pcs
 *   2x3/4 Tubing      → RM-MET-2X075-TUBING   → ft
 *   Flatbar           → RM-MET-FLATBAR        → ft
 *   Foam              → RM-RAW-FOAM           → boardft
 *   Iron Wood         → RM-RAW-IRON-WOOD      → pcs
 *
 * Does NOT POST the 373 missing ASM-/SA- product SKUs.
 *
 * Dry-run is the default.
 *
 *   npm run ops:katana-post-missing-materials
 *   npm run ops:katana-post-missing-materials -- --dry-run
 *   npm run ops:katana-post-missing-materials -- --confirm
 */
import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KatanaApiError, katanaFetch } from "../../src/lib/katana";
import { inferMaterialUom } from "../../src/lib/katana-material-uom";
import {
  HUB_REMINT_TARGETS,
  hubRemintSkuForName,
  isHubRemintName,
  normalizeSku,
} from "../../src/lib/katana-material-purge";
import { REQUEST_DELAY_MS, delay, unwrapList } from "./lib/csv";

loadEnvConfig(process.cwd());

const explicitDryRun = process.argv.includes("--dry-run");
const confirm = process.argv.includes("--confirm") && !explicitDryRun;
const dryRun = !confirm;

const PAGE_SIZE = 250;
const MAX_PAGES = 200;

type KatanaVariant = {
  id: number;
  sku?: string | null;
  type?: string | null;
  product_id?: number | null;
  material_id?: number | null;
  deleted_at?: string | null;
  purchase_price?: number | null;
};

type KatanaMaterial = {
  id: number;
  name?: string | null;
  uom?: string | null;
  is_archived?: boolean | null;
  archived_at?: string | null;
  variants?: KatanaVariant[] | null;
};

type RemintAction =
  | "would_patch"
  | "patched"
  | "would_post"
  | "posted"
  | "already_present"
  | "failed"
  | "skipped";

type PlanRow = {
  action: RemintAction;
  target_sku: string;
  name: string;
  material_id: string;
  variant_id: string;
  old_sku: string;
  old_uom: string;
  new_uom: string;
  status: string;
};

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

function isArchived(m: KatanaMaterial): boolean {
  if (m.is_archived === true) return true;
  if (m.archived_at != null && String(m.archived_at).trim() !== "") return true;
  return false;
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

async function main(): Promise<void> {
  console.log("Katana Hub material remint (PATCH-first)");
  console.log(`  mode: ${dryRun ? "DRY-RUN" : "LIVE (--confirm)"}`);
  console.log("  targets: 6 Hub blanks → RM-* + UoM (never ASM/SA as materials)");
  for (const t of HUB_REMINT_TARGETS) {
    const uom = inferMaterialUom(t.sku);
    console.log(`    ${t.name} → ${t.sku} (${uom.katanaUom})`);
  }
  console.log("");

  console.log("→ Loading /materials + /variants");
  const materials = await paginate<KatanaMaterial>(
    "/materials?include_deleted=false",
    "materials",
  );
  await delay(REQUEST_DELAY_MS);
  const variants = await paginate<KatanaVariant>("/variants", "variants");

  const materialVariantBySku = new Map<string, KatanaVariant>();
  for (const v of variants) {
    if (v.deleted_at) continue;
    const sku = normalizeSku(v.sku);
    if (!sku || !Number.isFinite(v.id)) continue;
    if (v.material_id != null && Number.isFinite(Number(v.material_id))) {
      if (!materialVariantBySku.has(sku)) {
        materialVariantBySku.set(sku, v);
      }
    }
  }

  // Blank Hub remint candidates: material with blank SKU + remint name.
  type BlankHit = {
    material: KatanaMaterial;
    variant: KatanaVariant;
    targetSku: string;
  };
  const blanksByTargetSku = new Map<string, BlankHit>();

  for (const m of materials) {
    if (isArchived(m)) continue;
    if (!isHubRemintName(m.name)) continue;
    const targetSku = hubRemintSkuForName(m.name);
    if (!targetSku) continue;
    const vars = Array.isArray(m.variants) ? m.variants : [];
    for (const v of vars) {
      if (!Number.isFinite(v.id)) continue;
      const sku = normalizeSku(v.sku);
      if (sku) {
        // Already has a SKU — if it's the target, already reminted on this row.
        continue;
      }
      if (!blanksByTargetSku.has(targetSku)) {
        blanksByTargetSku.set(targetSku, {
          material: m,
          variant: v,
          targetSku,
        });
      }
    }
  }

  const plan: PlanRow[] = [];

  for (const target of HUB_REMINT_TARGETS) {
    const uom = inferMaterialUom(target.sku);
    const existing = materialVariantBySku.get(target.sku);
    const blank = blanksByTargetSku.get(target.sku);

    if (existing) {
      plan.push({
        action: "already_present",
        target_sku: target.sku,
        name: target.name,
        material_id: String(existing.material_id ?? ""),
        variant_id: String(existing.id),
        old_sku: target.sku,
        old_uom: "",
        new_uom: uom.katanaUom,
        status: "ok",
      });
      continue;
    }

    if (blank) {
      const oldSku = normalizeSku(blank.variant.sku);
      const oldUom = (blank.material.uom ?? "").trim();
      if (dryRun) {
        plan.push({
          action: "would_patch",
          target_sku: target.sku,
          name: (blank.material.name ?? target.name).trim(),
          material_id: String(blank.material.id),
          variant_id: String(blank.variant.id),
          old_sku: oldSku,
          old_uom: oldUom,
          new_uom: uom.katanaUom,
          status: "dry_run",
        });
        continue;
      }

      try {
        await katanaFetch(`/materials/${blank.material.id}`, {
          method: "PATCH",
          body: {
            name: (blank.material.name ?? target.name).trim() || target.name,
            uom: uom.katanaUom,
          },
        });
        await delay(REQUEST_DELAY_MS);
        await katanaFetch(`/variants/${blank.variant.id}`, {
          method: "PATCH",
          body: { sku: target.sku },
        });
        await delay(REQUEST_DELAY_MS);
        plan.push({
          action: "patched",
          target_sku: target.sku,
          name: (blank.material.name ?? target.name).trim(),
          material_id: String(blank.material.id),
          variant_id: String(blank.variant.id),
          old_sku: oldSku,
          old_uom: oldUom,
          new_uom: uom.katanaUom,
          status: "ok",
        });
        console.log(
          `  patched material #${blank.material.id} → ${target.sku} uom=${uom.katanaUom}`,
        );
      } catch (e) {
        const detail =
          e instanceof KatanaApiError
            ? `${e.message}${e.details ? ` details=${JSON.stringify(e.details)}` : ""}`
            : e instanceof Error
              ? e.message
              : String(e);
        plan.push({
          action: "failed",
          target_sku: target.sku,
          name: (blank.material.name ?? target.name).trim(),
          material_id: String(blank.material.id),
          variant_id: String(blank.variant.id),
          old_sku: oldSku,
          old_uom: oldUom,
          new_uom: uom.katanaUom,
          status: detail.slice(0, 500),
        });
        console.warn(`  failed PATCH ${target.sku}: ${detail}`);
        await delay(REQUEST_DELAY_MS);
      }
      continue;
    }

    // No blank, no existing RM-* → POST
    if (dryRun) {
      plan.push({
        action: "would_post",
        target_sku: target.sku,
        name: target.name,
        material_id: "",
        variant_id: "",
        old_sku: "",
        old_uom: "",
        new_uom: uom.katanaUom,
        status: "dry_run",
      });
      continue;
    }

    try {
      const { data } = await katanaFetch<Record<string, unknown>>("/materials", {
        method: "POST",
        body: {
          name: target.name,
          uom: uom.katanaUom,
          is_sellable: false,
          variants: [{ sku: target.sku }],
        },
      });
      await delay(REQUEST_DELAY_MS);
      const materialId = Number(data.id);
      const variantsOut = Array.isArray(data.variants) ? data.variants : [];
      const first = variantsOut[0] as Record<string, unknown> | undefined;
      const variantId = first ? Number(first.id) : NaN;
      plan.push({
        action: "posted",
        target_sku: target.sku,
        name: target.name,
        material_id: Number.isFinite(materialId) ? String(materialId) : "",
        variant_id: Number.isFinite(variantId) ? String(variantId) : "",
        old_sku: "",
        old_uom: "",
        new_uom: uom.katanaUom,
        status: "ok",
      });
      console.log(
        `  posted material ${target.sku} id=${materialId} variant=${variantId}`,
      );
    } catch (e) {
      const detail =
        e instanceof KatanaApiError
          ? `${e.message}${e.details ? ` details=${JSON.stringify(e.details)}` : ""}`
          : e instanceof Error
            ? e.message
            : String(e);
      plan.push({
        action: "failed",
        target_sku: target.sku,
        name: target.name,
        material_id: "",
        variant_id: "",
        old_sku: "",
        old_uom: "",
        new_uom: uom.katanaUom,
        status: detail.slice(0, 500),
      });
      console.warn(`  failed POST ${target.sku}: ${detail}`);
      await delay(REQUEST_DELAY_MS);
    }
  }

  // Sanity: refuse accidental ASM/SA rows (hardcoded targets only — already enforced).
  for (const row of plan) {
    if (/^(ASM-|SA-|FIN-|CUT-)/.test(row.target_sku)) {
      throw new Error(
        `Refusing to remint weldment SKU as material: ${row.target_sku}`,
      );
    }
  }

  const outDir = join(process.cwd(), "tmp");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const planPath = join(
    outDir,
    `katana-remint-missing-materials-${stamp}.csv`,
  );

  writeCsv(
    planPath,
    [
      "action",
      "target_sku",
      "name",
      "material_id",
      "variant_id",
      "old_sku",
      "old_uom",
      "new_uom",
      "status",
    ],
    plan.map((r) => [
      r.action,
      r.target_sku,
      r.name,
      r.material_id,
      r.variant_id,
      r.old_sku,
      r.old_uom,
      r.new_uom,
      r.status,
    ]),
  );

  const counts = (action: RemintAction) =>
    plan.filter((r) => r.action === action).length;

  console.log("");
  console.log("Summary");
  console.log(`  targets:          ${HUB_REMINT_TARGETS.length}`);
  console.log(`  already_present:  ${counts("already_present")}`);
  console.log(`  would_patch:      ${counts("would_patch")}`);
  console.log(`  patched:          ${counts("patched")}`);
  console.log(`  would_post:       ${counts("would_post")}`);
  console.log(`  posted:           ${counts("posted")}`);
  console.log(`  failed:           ${counts("failed")}`);
  console.log(`  report: ${planPath}`);
  if (dryRun) {
    console.log("");
    console.log("Dry-run only. Re-run with --confirm to PATCH/POST.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

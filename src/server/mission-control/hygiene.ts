/**
 * Catalog Hygiene Radar.
 *
 * The quoting engine snapshots `finished_goods_catalog.msrp` and prints dimensions on the quote
 * package, so a product with no price, blank dimensions or no 3D asset is a product that stalls
 * or embarrasses a quote. The radar finds them; the Quick Access patch fixes the first two in
 * place without leaving the dashboard.
 *
 * The patch is idempotent: it diffs the request against the stored row inside one transaction,
 * writes only what differs, and writes one audit row per changed field. Sending the same patch
 * twice changes nothing the second time and adds no audit noise. It never touches the accounting ledger.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import {
  cad_uploads,
  finished_goods_catalog,
  logistics_profiles,
  pim_audit_log,
  sku_mappings,
} from "@/server/db/schema";
import { snapshotMsrp } from "@/server/quotes/msrp";

export type HygieneIssue = "missing_msrp" | "blank_dimensions" | "missing_3d_asset";

export const HYGIENE_ISSUE_LABEL: Record<HygieneIssue, string> = {
  missing_msrp: "Missing MSRP",
  blank_dimensions: "Blank dimensions",
  missing_3d_asset: "Missing 3D asset",
};

export const DIMENSION_FIELDS = ["length", "depth", "height"] as const;
export type DimensionField = (typeof DIMENSION_FIELDS)[number];

export const HYGIENE_AUDIT_ACTION = "hygiene_radar_patch";
const MAX_MSRP = 1_000_000;
const MAX_DIMENSION_IN = 1_000;

export type HygieneRow = {
  sku: string;
  name: string;
  hasCatalogRow: boolean;
  msrp: string | null;
  length: string | null;
  depth: string | null;
  height: string | null;
  naFields: readonly string[];
  has3d: boolean;
};

export type HygieneItem = {
  sku: string;
  name: string;
  issues: HygieneIssue[];
  hasCatalogRow: boolean;
  msrp: string | null;
  length: string | null;
  depth: string | null;
  height: string | null;
  /** Dimensions that are blank and not marked Not Applicable. */
  blankDimensions: DimensionField[];
  /** Dimensions currently marked Not Applicable. */
  notApplicable: DimensionField[];
  has3d: boolean;
};

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

/** True when the quote engine could not price this row, or would price it at zero. */
export function msrpMissing(msrp: string | null | undefined): boolean {
  const snap = snapshotMsrp(msrp);
  if (snap.priceError != null || snap.unitPrice == null) return true;
  return Number(snap.unitPrice) <= 0;
}

/** Returns null for a clean product. */
export function evaluateHygiene(row: HygieneRow): HygieneItem | null {
  const na = new Set(row.naFields);
  const values: Record<DimensionField, string | null> = {
    length: row.length,
    depth: row.depth,
    height: row.height,
  };
  const blankDimensions = DIMENSION_FIELDS.filter(
    (field) => !na.has(field) && isBlank(values[field]),
  );
  const issues: HygieneIssue[] = [];
  if (!row.hasCatalogRow || msrpMissing(row.msrp)) issues.push("missing_msrp");
  if (!row.hasCatalogRow || blankDimensions.length > 0) issues.push("blank_dimensions");
  if (!row.has3d) issues.push("missing_3d_asset");
  if (issues.length === 0) return null;
  return {
    sku: row.sku,
    name: row.name || row.sku,
    issues,
    hasCatalogRow: row.hasCatalogRow,
    msrp: row.msrp,
    length: row.length,
    depth: row.depth,
    height: row.height,
    blankDimensions: row.hasCatalogRow ? blankDimensions : [...DIMENSION_FIELDS].filter((f) => !na.has(f)),
    notApplicable: DIMENSION_FIELDS.filter((field) => na.has(field)),
    has3d: row.has3d,
  };
}

export type RadarTotals = {
  flagged: number;
  missingMsrp: number;
  blankDimensions: number;
  missing3d: number;
};

export function summarizeRadar(items: readonly HygieneItem[]): RadarTotals {
  const count = (issue: HygieneIssue) => items.filter((item) => item.issues.includes(issue)).length;
  return {
    flagged: items.length,
    missingMsrp: count("missing_msrp"),
    blankDimensions: count("blank_dimensions"),
    missing3d: count("missing_3d_asset"),
  };
}

/** Worst first: most issues, then SKU, so the order is stable between refreshes. */
export function rankRadar(items: readonly HygieneItem[]): HygieneItem[] {
  return [...items].sort(
    (a, b) => b.issues.length - a.issues.length || a.sku.localeCompare(b.sku),
  );
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export type Normalized = { ok: true; value: string } | { ok: false; error: string };

/** "$1,299" and "1299.5" become "1299.00" and "1299.50". Zero and negatives are refused. */
export function normalizeMsrp(raw: string): Normalized {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: "MSRP must be a dollar amount such as 1299 or 1299.50." };
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: "MSRP must be greater than zero." };
  }
  if (value > MAX_MSRP) return { ok: false, error: "MSRP is above the allowed maximum." };
  return { ok: true, value: value.toFixed(2) };
}

/** `84`, `84"` and `84 in` become "84". Up to two decimals, no trailing zeros. */
export function normalizeDimension(raw: string, label = "Dimension"): Normalized {
  const cleaned = raw.trim().replace(/(?:"|in\.?|inches)$/i, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return { ok: false, error: `${label} must be a number of inches such as 84 or 36.5.` };
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: `${label} must be greater than zero.` };
  }
  if (value > MAX_DIMENSION_IN) return { ok: false, error: `${label} is above the allowed maximum.` };
  return { ok: true, value: String(value) };
}

// ---------------------------------------------------------------------------
// Patch planning (pure)
// ---------------------------------------------------------------------------

export const hygienePatchSchema = z
  .object({
    sku: z.string().trim().min(1, "A SKU is required.").max(128),
    msrp: z.string().trim().max(32).optional(),
    length: z.string().trim().max(16).optional(),
    depth: z.string().trim().max(16).optional(),
    height: z.string().trim().max(16).optional(),
    /** The COMPLETE set of dimensions that should be Not Applicable after the patch. */
    notApplicable: z.array(z.enum(DIMENSION_FIELDS)).max(3).optional(),
  })
  .strict();

export type HygienePatchInput = z.input<typeof hygienePatchSchema>;

export type CatalogSnapshot = {
  msrp: string | null;
  length: string | null;
  depth: string | null;
  height: string | null;
  na_fields: readonly string[];
};

export type PatchChange = { field: string; oldValue: string | null; newValue: string | null };

export type PatchSet = Partial<Record<"msrp" | DimensionField, string>> & { na_fields?: string[] };

export type PatchPlan =
  | { ok: true; changes: PatchChange[]; set: PatchSet }
  | { ok: false; error: string };

function sameDimension(existing: string | null, next: string): boolean {
  if (existing == null) return false;
  const normalized = normalizeDimension(existing);
  return normalized.ok ? normalized.value === next : existing.trim() === next;
}

/**
 * Diff a validated patch against the stored row. Returns only real changes, so planning the
 * same patch against the updated row returns an empty plan.
 */
export function planHygienePatch(
  existing: CatalogSnapshot | null,
  input: z.output<typeof hygienePatchSchema>,
): PatchPlan {
  const changes: PatchChange[] = [];
  const set: PatchSet = {};

  if (input.msrp !== undefined && input.msrp !== "") {
    const msrp = normalizeMsrp(input.msrp);
    if (!msrp.ok) return msrp;
    const stored = existing?.msrp == null ? null : snapshotMsrp(existing.msrp).unitPrice;
    if (stored === null || Number(stored) !== Number(msrp.value)) {
      changes.push({ field: "msrp", oldValue: existing?.msrp ?? null, newValue: msrp.value });
      set.msrp = msrp.value;
    }
  }

  const desiredNa = input.notApplicable ? new Set<string>(input.notApplicable) : null;
  for (const field of DIMENSION_FIELDS) {
    const raw = input[field];
    const hasValue = raw !== undefined && raw !== "";
    if (hasValue && desiredNa?.has(field)) {
      return { ok: false, error: `${field[0]!.toUpperCase()}${field.slice(1)}: choose a value or Not Applicable, not both.` };
    }
    if (!hasValue) continue;
    const label = `${field[0]!.toUpperCase()}${field.slice(1)}`;
    const normalized = normalizeDimension(raw, label);
    if (!normalized.ok) return normalized;
    if (!sameDimension(existing?.[field] ?? null, normalized.value)) {
      changes.push({ field, oldValue: existing?.[field] ?? null, newValue: normalized.value });
      set[field] = normalized.value;
    }
  }

  if (desiredNa) {
    const current = existing?.na_fields ?? [];
    // Keep keys this patch does not own (msrp, image, arm_height, ...). Own the three dimensions.
    const foreign = current.filter((key) => !(DIMENSION_FIELDS as readonly string[]).includes(key));
    const next = [...foreign, ...DIMENSION_FIELDS.filter((field) => desiredNa.has(field))];
    const before = new Set(current);
    const same = next.length === before.size && next.every((key) => before.has(key));
    if (!same) {
      changes.push({
        field: "na_fields",
        oldValue: [...current].sort().join(",") || null,
        newValue: [...next].sort().join(",") || null,
      });
      set.na_fields = next;
    }
  }

  return { ok: true, changes, set };
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export async function loadHygieneRows(): Promise<HygieneRow[]> {
  const db = getDb();
  const [rows, cadRows] = await Promise.all([
    db
      .select({
        sku: sku_mappings.global_sku,
        name: sku_mappings.original_name,
        hasCatalogRow: sql<boolean>`${finished_goods_catalog.global_sku} is not null`,
        msrp: finished_goods_catalog.msrp,
        length: finished_goods_catalog.length,
        depth: finished_goods_catalog.depth,
        height: finished_goods_catalog.height,
        naFields: finished_goods_catalog.na_fields,
        asset3d: logistics_profiles.asset_3d_url,
      })
      .from(sku_mappings)
      .leftJoin(finished_goods_catalog, eq(finished_goods_catalog.global_sku, sku_mappings.global_sku))
      .leftJoin(
        logistics_profiles,
        eq(logistics_profiles.katana_variant_id, sku_mappings.katana_variant_id),
      )
      .where(and(eq(sku_mappings.item_type, "finished_good"), eq(sku_mappings.is_active, true))),
    // A GLB or GLTF CAD upload that did not fail also counts as a 3D asset.
    db
      .selectDistinct({ sku: cad_uploads.global_sku })
      .from(cad_uploads)
      .where(
        and(
          inArray(sql<string>`lower(${cad_uploads.ext})`, ["glb", "gltf"]),
          sql`${cad_uploads.status} <> 'failed'`,
        ),
      ),
  ]);

  const withCad = new Set(cadRows.map((row) => row.sku));
  return rows.map((row) => ({
    sku: row.sku,
    name: row.name,
    hasCatalogRow: Boolean(row.hasCatalogRow),
    msrp: row.msrp,
    length: row.length,
    depth: row.depth,
    height: row.height,
    naFields: row.naFields ?? [],
    has3d: !isBlank(row.asset3d) || withCad.has(row.sku),
  }));
}

export type RadarResult = {
  items: HygieneItem[];
  totals: RadarTotals;
  scanned: number;
  truncated: boolean;
};

export const RADAR_ITEM_LIMIT = 100;

export async function scanHygieneRadar(limit = RADAR_ITEM_LIMIT): Promise<RadarResult> {
  const rows = await loadHygieneRows();
  const flagged = rankRadar(rows.map(evaluateHygiene).filter((item): item is HygieneItem => item !== null));
  return {
    items: flagged.slice(0, limit),
    totals: summarizeRadar(flagged),
    scanned: rows.length,
    truncated: flagged.length > limit,
  };
}

export type PatchActor = { email: string; label: string };

export type PatchOutcome =
  | { ok: true; changed: boolean; fields: string[] }
  | { ok: false; error: string };

/**
 * One transaction: lock the catalog row, diff, write only what differs, audit each change.
 * A failure rolls everything back and is thrown to the caller (no swallowed errors here).
 */
export async function applyHygienePatch(
  rawInput: unknown,
  actor: PatchActor,
): Promise<PatchOutcome> {
  const parsed = hygienePatchSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That patch is not valid." };
  }
  const input = parsed.data;
  const sku = input.sku.toUpperCase();

  return getDb().transaction(async (tx) => {
    // `SELECT ... FOR UPDATE` below locks nothing when the product has no catalog row yet, so two
    // simultaneous first patches would both "change" and double the audit rows (found by the live
    // Postgres suite). A per-SKU transaction advisory lock serialises them; it is released at
    // commit or rollback and is safe on the Supavisor transaction pooler.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`hygiene-patch:${sku}`}, 0))`);

    const [mapping] = await tx
      .select({ sku: sku_mappings.global_sku, itemType: sku_mappings.item_type })
      .from(sku_mappings)
      .where(sql`upper(${sku_mappings.global_sku}) = ${sku}`)
      .limit(1);
    if (!mapping || mapping.itemType !== "finished_good") {
      return { ok: false as const, error: "That product could not be found." };
    }

    const [existing] = await tx
      .select({
        msrp: finished_goods_catalog.msrp,
        length: finished_goods_catalog.length,
        depth: finished_goods_catalog.depth,
        height: finished_goods_catalog.height,
        na_fields: finished_goods_catalog.na_fields,
      })
      .from(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, mapping.sku))
      .for("update")
      .limit(1);

    const plan = planHygienePatch(existing ?? null, input);
    if (!plan.ok) return plan;
    if (plan.changes.length === 0) {
      return { ok: true as const, changed: false, fields: [] };
    }

    const now = new Date();
    if (existing) {
      await tx
        .update(finished_goods_catalog)
        .set({ ...plan.set, updated_by: actor.email, updated_at: now })
        .where(eq(finished_goods_catalog.global_sku, mapping.sku));
    } else {
      await tx
        .insert(finished_goods_catalog)
        .values({ global_sku: mapping.sku, ...plan.set, updated_by: actor.email, updated_at: now })
        .onConflictDoUpdate({
          target: finished_goods_catalog.global_sku,
          set: { ...plan.set, updated_by: actor.email, updated_at: now },
        });
    }

    await tx.insert(pim_audit_log).values(
      plan.changes.map((change) => ({
        operator_email: actor.email,
        operator_name: actor.label,
        global_sku: mapping.sku,
        action: HYGIENE_AUDIT_ACTION,
        field: change.field,
        old_value: change.oldValue,
        new_value: change.newValue,
      })),
    );

    return { ok: true as const, changed: true, fields: plan.changes.map((change) => change.field) };
  });
}

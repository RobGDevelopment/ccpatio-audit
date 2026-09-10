/**
 * Recursive BOM explosion — single Postgres round-trip for welded multi-level trees.
 * Drizzle relations cannot walk 12 levels efficiently; use WITH RECURSIVE.
 *
 * Binding SoT: docs/MDM_MASTER_BLUEPRINT.md Phase 1.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";

export type BomExplosionRow = {
  root_sku: string;
  parent_sku: string;
  child_sku: string;
  quantity: string;
  scrap_factor: string;
  unit_of_measure: string;
  notes: string | null;
  depth: number;
  path: string[];
};

const MAX_BOM_DEPTH = 12;

/**
 * Explode the entire nested `product_bom` tree under `rootSku`
 * (children, quantities, scrap factors) in one query.
 */
export async function explodeBomTree(
  rootSku: string,
): Promise<BomExplosionRow[]> {
  const db = getDb();
  const trimmed = rootSku.trim();
  if (!trimmed) {
    return [];
  }

  const result = await db.execute(sql`
    WITH RECURSIVE bom_explosion AS (
      SELECT
        ${trimmed}::text AS root_sku,
        pb.parent_sku,
        pb.child_sku,
        pb.quantity,
        pb.scrap_factor,
        pb.unit_of_measure,
        pb.notes,
        1 AS depth,
        ARRAY[pb.parent_sku, pb.child_sku]::text[] AS path
      FROM product_bom pb
      WHERE pb.parent_sku = ${trimmed}
      UNION ALL
      SELECT
        be.root_sku,
        pb.parent_sku,
        pb.child_sku,
        pb.quantity,
        pb.scrap_factor,
        pb.unit_of_measure,
        pb.notes,
        be.depth + 1,
        be.path || pb.child_sku
      FROM product_bom pb
      INNER JOIN bom_explosion be ON pb.parent_sku = be.child_sku
      WHERE be.depth < ${MAX_BOM_DEPTH}
        AND NOT (pb.child_sku = ANY (be.path))
    )
    SELECT
      root_sku,
      parent_sku,
      child_sku,
      quantity::text,
      scrap_factor::text,
      unit_of_measure,
      notes,
      depth,
      path
    FROM bom_explosion
    ORDER BY depth ASC, parent_sku ASC, child_sku ASC
  `);

  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);

  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const pathRaw = r.path;
    const path = Array.isArray(pathRaw)
      ? pathRaw.map(String)
      : typeof pathRaw === "string"
        ? pathRaw.replace(/^\{|\}$/g, "").split(",").filter(Boolean)
        : [];

    return {
      root_sku: String(r.root_sku ?? trimmed),
      parent_sku: String(r.parent_sku ?? ""),
      child_sku: String(r.child_sku ?? ""),
      quantity: String(r.quantity ?? "0"),
      scrap_factor: String(r.scrap_factor ?? "1"),
      unit_of_measure: String(r.unit_of_measure ?? ""),
      notes: r.notes == null ? null : String(r.notes),
      depth: Number(r.depth ?? 0),
      path,
    };
  });
}

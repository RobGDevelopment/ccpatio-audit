import { and, asc, eq, ilike, like, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { raw_materials_catalog, sku_mappings } from "@/server/db/schema";
import type { FinishChoice } from "@/lib/intake/types";

export type FinishItem = {
  sku: string;
  name: string;
};

const KIND_PREFIX_MAP = {
  frame: "MET-",
  powder: "PWD-",
  fabric: "FAB-",
} as const;

export async function searchFinishes(
  kind: "frame" | "powder" | "fabric",
  query?: string,
  limit = 50
): Promise<FinishItem[]> {
  const db = getDb();
  const prefix = KIND_PREFIX_MAP[kind];
  const boundedLimit = Math.min(Math.max(limit, 1), 100);

  const conditions = [
    like(sku_mappings.global_sku, `${prefix}%`),
    eq(sku_mappings.item_type, "raw_material"),
  ];

  if (query && query.trim().length > 0) {
    const q = `%${query.trim()}%`;
    conditions.push(
      or(
        ilike(sku_mappings.global_sku, q),
        ilike(raw_materials_catalog.name, q),
        ilike(sku_mappings.original_name, q)
      )!
    );
  }

  const rows = await db
    .select({
      sku: sku_mappings.global_sku,
      rawName: raw_materials_catalog.name,
      mappingName: sku_mappings.original_name,
    })
    .from(sku_mappings)
    .leftJoin(raw_materials_catalog, eq(sku_mappings.global_sku, raw_materials_catalog.sku))
    .where(and(...conditions))
    .orderBy(asc(sql`COALESCE(NULLIF(${raw_materials_catalog.name}, ''), ${sku_mappings.original_name}, ${sku_mappings.global_sku})`))
    .limit(boundedLimit);

  return rows.map((r) => ({
    sku: r.sku,
    name: r.rawName || r.mappingName || r.sku,
  }));
}

export type ValidateFinishesResult =
  | {
      ok: true;
      finishesPending: boolean;
      resolvedFinishes: {
        frame: FinishChoice;
        powder: FinishChoice;
        fabric: FinishChoice;
      };
    }
  | {
      ok: false;
      fieldErrors: Record<string, string>;
    };

export async function validateFinishSelection(selection: {
  frame: FinishChoice;
  powder: FinishChoice;
  fabric: FinishChoice;
}): Promise<ValidateFinishesResult> {
  const db = getDb();
  const fieldErrors: Record<string, string> = {};
  let finishesPending = false;

  const slots = ["frame", "powder", "fabric"] as const;

  for (const slot of slots) {
    const choice = selection[slot];
    if (!choice) {
      fieldErrors[slot] = "Finish selection is required";
      continue;
    }

    if (choice.kind === "tbd") {
      finishesPending = true;
      if (!choice.note || choice.note.trim().length < 5) {
        fieldErrors[slot] = "A note of at least 5 characters is required for pending finishes";
      } else if (choice.note.trim().length > 200) {
        fieldErrors[slot] = "Note must be under 200 characters";
      }
    } else if (choice.kind === "sku") {
      const expectedPrefix = KIND_PREFIX_MAP[slot];
      if (!choice.sku.startsWith(expectedPrefix)) {
        fieldErrors[slot] = `Invalid finish for ${slot}. Must begin with ${expectedPrefix}`;
        continue;
      }

      // Check DB existence
      const mapping = await db.query.sku_mappings.findFirst({
        where: eq(sku_mappings.global_sku, choice.sku),
      });

      if (!mapping) {
        fieldErrors[slot] = `Finish code ${choice.sku} does not exist`;
      }
    } else {
      fieldErrors[slot] = "Invalid finish kind";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    finishesPending,
    resolvedFinishes: selection,
  };
}

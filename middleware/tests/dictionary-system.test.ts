import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  fetchPimDeltas,
  patchAttributeField,
  patchCatalogField,
  patchMappingField,
  setCatalogFieldNotApplicable,
} from "@/app/admin/dictionary/actions";
import { getDb, closeDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  sku_mappings,
} from "@/server/db/schema";

const hasDb = Boolean(process.env.POSTGRES_URL);

type Snapshot = {
  mapping: typeof sku_mappings.$inferSelect;
  catalog: typeof finished_goods_catalog.$inferSelect | null;
};

async function loadSnapshot(globalSku: string): Promise<Snapshot | null> {
  const db = getDb();
  const [row] = await db
    .select({
      mapping: sku_mappings,
      catalog: finished_goods_catalog,
    })
    .from(sku_mappings)
    .leftJoin(
      finished_goods_catalog,
      eq(sku_mappings.global_sku, finished_goods_catalog.global_sku),
    )
    .where(eq(sku_mappings.global_sku, globalSku))
    .limit(1);
  if (!row) return null;
  return { mapping: row.mapping, catalog: row.catalog };
}

async function restoreSnapshot(snap: Snapshot): Promise<void> {
  const db = getDb();
  await db
    .update(sku_mappings)
    .set({
      category: snap.mapping.category,
      item_type: snap.mapping.item_type,
      original_name: snap.mapping.original_name,
      is_active: snap.mapping.is_active,
      uom_purchase: snap.mapping.uom_purchase,
      uom_consume: snap.mapping.uom_consume,
      base_cost: snap.mapping.base_cost,
      woo_attribute_slug: snap.mapping.woo_attribute_slug,
      ghl_dropdown_value: snap.mapping.ghl_dropdown_value,
      attributes: snap.mapping.attributes,
      version: snap.mapping.version,
      updated_by: snap.mapping.updated_by,
      updated_at: snap.mapping.updated_at,
    })
    .where(eq(sku_mappings.global_sku, snap.mapping.global_sku));

  if (snap.catalog) {
    const [existing] = await db
      .select({ global_sku: finished_goods_catalog.global_sku })
      .from(finished_goods_catalog)
      .where(eq(finished_goods_catalog.global_sku, snap.mapping.global_sku))
      .limit(1);
    if (existing) {
      await db
        .update(finished_goods_catalog)
        .set({
          msrp: snap.catalog.msrp,
          cost: snap.catalog.cost,
          length: snap.catalog.length,
          depth: snap.catalog.depth,
          height: snap.catalog.height,
          arm_height: snap.catalog.arm_height,
          sit_height: snap.catalog.sit_height,
          weight: snap.catalog.weight,
          description: snap.catalog.description,
          image_url: snap.catalog.image_url,
          qbo_item_code: snap.catalog.qbo_item_code,
          na_fields: snap.catalog.na_fields,
          updated_by: snap.catalog.updated_by,
          updated_at: snap.catalog.updated_at,
        })
        .where(eq(finished_goods_catalog.global_sku, snap.mapping.global_sku));
    }
  }
}

describe.skipIf(!hasDb)("dictionary system integration", () => {
  let fgSku = "";
  let attrSku = "";
  let fgSnap: Snapshot | null = null;
  let attrSnap: Snapshot | null = null;

  beforeAll(async () => {
    const db = getDb();
    const [fg] = await db
      .select({ global_sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.category, "Finished Good"))
      .limit(1);
    if (!fg) {
      throw new Error("No Finished Good SKU in database for integration test");
    }
    fgSku = fg.global_sku;
    fgSnap = await loadSnapshot(fgSku);
    if (!fgSnap) {
      throw new Error(`Could not load snapshot for ${fgSku}`);
    }

    const [metal] = await db
      .select({ global_sku: sku_mappings.global_sku })
      .from(sku_mappings)
      .where(eq(sku_mappings.category, "Metal"))
      .limit(1);
    if (metal) {
      attrSku = metal.global_sku;
      attrSnap = await loadSnapshot(attrSku);
    }
  });

  afterAll(async () => {
    if (fgSnap) await restoreSnapshot(fgSnap);
    if (attrSnap) await restoreSnapshot(attrSnap);
    await closeDb();
  });

  it("patches every catalog inline field and returns na_fields", async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const catalogFields: Array<{ field: string; value: string }> = [
      { field: "msrp", value: "$1,234.00" },
      { field: "length", value: "99" },
      { field: "depth", value: "88" },
      { field: "height", value: "77" },
      { field: "weight", value: "55" },
      { field: "description", value: "integration-test-desc" },
      { field: "qbo_item_code", value: "QBO-TEST" },
    ];

    for (const { field, value } of catalogFields) {
      const result = await patchCatalogField({
        globalSku: fgSku,
        field,
        value,
        updatedBy: "vitest-operator-a",
      });
      expect(result.ok, `${field} patch failed: ${!result.ok ? result.error : ""}`).toBe(
        true,
      );
    }

    const naResult = await setCatalogFieldNotApplicable(fgSku, "arm_height", true);
    expect(naResult.ok).toBe(true);
    if (naResult.ok) {
      expect(naResult.naFields).toContain("arm_height");
    }

    const deltas = await fetchPimDeltas(since);
    const row = deltas.find((d) => d.globalSku === fgSku);
    expect(row).toBeDefined();
    expect(row?.catalog?.length).toBe("99");
    expect(row?.catalog?.description).toBe("integration-test-desc");
  });

  it("patches mapping fields with optimistic concurrency", async () => {
    const snap = await loadSnapshot(fgSku);
    expect(snap).not.toBeNull();
    const version = snap!.mapping.version;

    const ok = await patchMappingField({
      globalSku: fgSku,
      field: "original_name",
      value: "Vitest Concurrent Name A",
      updatedBy: "vitest-operator-a",
      expectedVersion: version,
    });
    expect(ok.ok).toBe(true);

    const conflict = await patchMappingField({
      globalSku: fgSku,
      field: "original_name",
      value: "Vitest Concurrent Name B",
      updatedBy: "vitest-operator-b",
      expectedVersion: version,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.code).toBe("VERSION_CONFLICT");
    }

    const fresh = await loadSnapshot(fgSku);
    const okB = await patchMappingField({
      globalSku: fgSku,
      field: "original_name",
      value: "Vitest Concurrent Name B",
      updatedBy: "vitest-operator-b",
      expectedVersion: fresh!.mapping.version,
    });
    expect(okB.ok).toBe(true);

    for (const field of [
      "uom_purchase",
      "uom_consume",
      "woo_attribute_slug",
      "ghl_dropdown_value",
    ] as const) {
      const result = await patchMappingField({
        globalSku: fgSku,
        field,
        value: field === "uom_purchase" || field === "uom_consume" ? "ea" : "vitest",
        updatedBy: "vitest-operator-a",
        expectedVersion: undefined,
      });
      expect(result.ok, `${field} failed`).toBe(true);
    }
  });

  it("patches category attribute JSON paths", async () => {
    if (!attrSku) return;
    const snap = await loadSnapshot(attrSku);
    expect(snap).not.toBeNull();

    const result = await patchAttributeField({
      globalSku: attrSku,
      path: "stick_len_in",
      value: "144",
      updatedBy: "vitest-operator-a",
      expectedVersion: snap!.mapping.version,
    });
    expect(result.ok).toBe(true);
  });
});

describe("realtime poll contract", () => {
  it("fetchPimDeltas rejects invalid since timestamps", async () => {
    if (!hasDb) return;
    const rows = await fetchPimDeltas("not-a-date");
    expect(rows).toEqual([]);
    await closeDb();
  });
});

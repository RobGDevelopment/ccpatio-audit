import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Real PostgreSQL engine (PGlite) proof of the SKU-authority SQL: the exists() subqueries, the
 * archived-listing rule, the jsonb `web_sellable` read, the enum column and the recursive BOM CTE.
 * The DDL below is the minimal column set the resolver reads (the live schema has more columns;
 * Drizzle only references the selected ones), with the real `item_type` enum values.
 */
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/server/db/client", () => ({ getDb: () => state.db }));

import {
  hubResolveDeps,
  lookupSkusFromHub,
  recipeSkusFromHub,
  resolveWooOrder,
} from "@/server/woocommerce/sku-resolver";
import { BASE_SKU, FAB_SKU, PWD_SKU, wooLine, wooOrder } from "./helpers/woo-fakes";

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  state.db = drizzle(pg);
  await pg.exec(`
    CREATE TYPE item_type AS ENUM ('raw_material','sub_assembly','finished_good','service');
    CREATE TABLE sku_mappings (
      global_sku text PRIMARY KEY,
      item_type item_type NOT NULL DEFAULT 'raw_material',
      is_active boolean NOT NULL DEFAULT true,
      sync_to_woo boolean NOT NULL DEFAULT false,
      katana_variant_id integer,
      attributes jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE finished_goods_catalog (global_sku text PRIMARY KEY REFERENCES sku_mappings(global_sku));
    CREATE TABLE ecommerce_listings (
      id serial PRIMARY KEY,
      global_sku text NOT NULL REFERENCES sku_mappings(global_sku),
      archived_at timestamp
    );
    CREATE TABLE product_bom (
      parent_sku text NOT NULL,
      child_sku text NOT NULL,
      quantity numeric NOT NULL DEFAULT 1,
      scrap_factor numeric NOT NULL DEFAULT 1,
      unit_of_measure text NOT NULL DEFAULT 'ea',
      notes text,
      PRIMARY KEY (parent_sku, child_sku)
    );

    INSERT INTO sku_mappings (global_sku, item_type, sync_to_woo, katana_variant_id, attributes) VALUES
      ('${BASE_SKU}', 'finished_good', false, 100, '{}'),
      ('FIN-ARCHIVED-ONLY', 'finished_good', false, 101, '{}'),
      ('FIN-NO-CATALOG', 'finished_good', true, 102, '{}'),
      ('${FAB_SKU}', 'raw_material', false, 201, '{"web_sellable": true}'),
      ('${PWD_SKU}', 'raw_material', false, 301, '{"web_sellable": true}'),
      ('MET-ALUM', 'raw_material', false, 401, '{"web_sellable": true}'),
      ('FAB-HIDDEN', 'raw_material', false, 202, '{"web_sellable": "yes"}'),
      ('RM-FAB-GENERIC', 'raw_material', false, 901, '{}'),
      ('RM-PWD-GENERIC', 'raw_material', false, 902, '{}'),
      ('SA-TST-CHA-FRAME', 'sub_assembly', false, NULL, '{}'),
      ('SA-TST-CHA-CUSH', 'sub_assembly', false, NULL, '{}');
    INSERT INTO finished_goods_catalog (global_sku) VALUES ('${BASE_SKU}'), ('FIN-ARCHIVED-ONLY');
    INSERT INTO ecommerce_listings (global_sku, archived_at) VALUES
      ('${BASE_SKU}', NULL),
      ('FIN-ARCHIVED-ONLY', now());
    INSERT INTO product_bom (parent_sku, child_sku) VALUES
      ('${BASE_SKU}', 'SA-TST-CHA-FRAME'),
      ('${BASE_SKU}', 'SA-TST-CHA-CUSH'),
      ('SA-TST-CHA-CUSH', 'RM-FAB-GENERIC'),
      ('SA-TST-CHA-FRAME', 'RM-PWD-GENERIC');
  `);
});

afterAll(async () => {
  await pg.close();
});

describe("lookupSkusFromHub (real SQL)", () => {
  it("returns type, flags, variant id, jsonb attributes and the two exists() booleans", async () => {
    const map = await lookupSkusFromHub([BASE_SKU, FAB_SKU, "FIN-ARCHIVED-ONLY", "FIN-NO-CATALOG", "NOPE-1"]);
    expect(map.has("NOPE-1")).toBe(false);

    expect(map.get(BASE_SKU)).toMatchObject({
      itemType: "finished_good",
      isActive: true,
      syncToWoo: false,
      katanaVariantId: 100,
      hasCatalogRow: true,
      hasActiveListing: true,
    });
    expect(map.get(FAB_SKU)).toMatchObject({
      itemType: "raw_material",
      attributes: { web_sellable: true },
      hasCatalogRow: false,
    });
    // An ARCHIVED listing does not approve a SKU for web.
    expect(map.get("FIN-ARCHIVED-ONLY")).toMatchObject({ hasCatalogRow: true, hasActiveListing: false });
    expect(map.get("FIN-NO-CATALOG")).toMatchObject({ syncToWoo: true, hasCatalogRow: false });
  });

  it("an empty batch makes no query and returns an empty map", async () => {
    expect((await lookupSkusFromHub([])).size).toBe(0);
  });
});

describe("recipeSkusFromHub (recursive CTE)", () => {
  it("returns every descendant child SKU of the finished good", async () => {
    const recipe = await recipeSkusFromHub(BASE_SKU);
    expect(recipe.sort()).toEqual(
      ["RM-FAB-GENERIC", "RM-PWD-GENERIC", "SA-TST-CHA-CUSH", "SA-TST-CHA-FRAME"].sort(),
    );
  });

  it("a SKU with no recipe returns an empty list", async () => {
    expect(await recipeSkusFromHub("FIN-NO-CATALOG")).toEqual([]);
  });
});

describe("resolveWooOrder against real PostgreSQL", () => {
  it("accepts an order whose SKU, finishes and recipe all live in the database", async () => {
    const result = await resolveWooOrder(wooOrder(), hubResolveDeps(), { requireKatanaIds: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]!.finishes.map((f) => [f.slot, f.mode, f.genericVariantId])).toEqual([
      ["fabric", "swap", 901],
      ["powder_coat", "swap", 902],
      ["frame", "attribute_only", null],
    ]);
  });

  it("rejects a web_sellable that is not boolean true, an archived-only listing, and a missing catalog row", async () => {
    const hidden = await resolveWooOrder(
      wooOrder({
        line_items: [wooLine({ meta_data: [{ key: "fabric", value: "FAB-HIDDEN" }, { key: "powder_coat", value: PWD_SKU }, { key: "frame", value: "MET-ALUM" }] })],
      }),
      hubResolveDeps(),
      { requireKatanaIds: false },
    );
    expect(hidden.ok).toBe(false);

    for (const sku of ["FIN-ARCHIVED-ONLY", "FIN-NO-CATALOG"]) {
      const res = await resolveWooOrder(wooOrder({ line_items: [wooLine({ sku })] }), hubResolveDeps(), {
        requireKatanaIds: false,
      });
      expect(res.ok, sku).toBe(false);
    }
  });
});

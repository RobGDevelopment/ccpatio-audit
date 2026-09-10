import path from "path";
import * as dotenv from "dotenv";
import { eq, inArray, or } from "drizzle-orm";
import { getDb, closeDb } from "../../../src/server/db/client";
import {
  finished_goods_catalog,
  item_operations,
  item_operations_draft,
  product_bom,
  product_bom_draft,
  raw_materials_catalog,
  sku_mappings,
} from "../../../src/server/db/schema";

dotenv.config({ path: path.resolve(process.cwd(), ".env.test.local") });
dotenv.config({
  path: path.resolve(process.cwd(), ".env.local"),
  override: true,
});

export const E2E_FG_SKU = "FIN-TEST-SOFA";
export const E2E_FRAME_SKU = "SA-TEST-SOFA-FRAME";
export const E2E_CUSH_SKU = "SA-TEST-SOFA-CUSH";
export const E2E_FABRIC_SKU = "RM-FAB-GENERIC";
export const E2E_POWDER_SKU = "RM-PWD-GENERIC";
export const E2E_CAP_SKU = "RM-HRD-2X2-CAP";
export const E2E_SOURCE_FILE = "vividworks_phase1_e2e";

const OWNED_SKUS = [E2E_FG_SKU, E2E_FRAME_SKU, E2E_CUSH_SKU, E2E_CAP_SKU] as const;
const GRAPH_PARENTS = [E2E_FG_SKU, E2E_FRAME_SKU, E2E_CUSH_SKU] as const;

async function upsertMapping(input: {
  sku: string;
  name: string;
  itemType: "finished_good" | "sub_assembly" | "raw_material";
  category: string;
  sourceFile: string;
  uom: string;
  variantId: number;
}): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ sku: sku_mappings.global_sku, variantId: sku_mappings.katana_variant_id })
    .from(sku_mappings)
    .where(eq(sku_mappings.global_sku, input.sku))
    .limit(1);

  if (!existing) {
    await db.insert(sku_mappings).values({
      global_sku: input.sku,
      original_name: input.name,
      item_type: input.itemType,
      category: input.category,
      source_file: input.sourceFile,
      is_active: true,
      uom_consume: input.uom,
      katana_variant_id: input.variantId,
    });
    return;
  }

  const sharedPlaceholder =
    input.sku === E2E_FABRIC_SKU || input.sku === E2E_POWDER_SKU;
  await db
    .update(sku_mappings)
    .set({
      item_type: input.itemType,
      is_active: true,
      uom_consume: input.uom,
      katana_variant_id: existing.variantId ?? input.variantId,
      updated_at: new Date(),
      ...(sharedPlaceholder
        ? {}
        : {
            original_name: input.name,
            category: input.category,
            source_file: input.sourceFile,
          }),
    })
    .where(eq(sku_mappings.global_sku, input.sku));
}

async function upsertRawMaterial(sku: string, name: string, category: string, uom: string) {
  const db = getDb();
  const [existing] = await db
    .select({ sku: raw_materials_catalog.sku })
    .from(raw_materials_catalog)
    .where(eq(raw_materials_catalog.sku, sku))
    .limit(1);
  if (existing) return;
  await db.insert(raw_materials_catalog).values({
    sku,
    name,
    category,
    unit_of_measure: uom,
  });
}

export async function cleanupFactoryBomE2eSeed(): Promise<void> {
  const db = getDb();
  const parentList = [...GRAPH_PARENTS];
  await db
    .delete(product_bom_draft)
    .where(
      or(
        inArray(product_bom_draft.parent_sku, parentList),
        inArray(product_bom_draft.child_sku, [...OWNED_SKUS]),
      )!,
    );
  await db
    .delete(product_bom)
    .where(
      or(
        inArray(product_bom.parent_sku, parentList),
        inArray(product_bom.child_sku, [...OWNED_SKUS]),
      )!,
    );
  await db
    .delete(item_operations_draft)
    .where(inArray(item_operations_draft.item_sku, parentList));
  await db.delete(item_operations).where(inArray(item_operations.item_sku, parentList));
  await db.delete(finished_goods_catalog).where(eq(finished_goods_catalog.global_sku, E2E_FG_SKU));
  await db.delete(raw_materials_catalog).where(eq(raw_materials_catalog.sku, E2E_CAP_SKU));
  await db.delete(sku_mappings).where(inArray(sku_mappings.global_sku, [...OWNED_SKUS]));
}

export async function seedFactoryBomE2eDraft(): Promise<void> {
  const db = getDb();
  await cleanupFactoryBomE2eSeed();

  await upsertMapping({
    sku: E2E_FG_SKU,
    name: "E2E Test Sofa",
    itemType: "finished_good",
    category: "E2E",
    sourceFile: E2E_SOURCE_FILE,
    uom: "ea",
    variantId: 91001,
  });
  await upsertMapping({
    sku: E2E_FRAME_SKU,
    name: "E2E Test Sofa Frame",
    itemType: "sub_assembly",
    category: "E2E",
    sourceFile: E2E_SOURCE_FILE,
    uom: "ea",
    variantId: 91002,
  });
  await upsertMapping({
    sku: E2E_CUSH_SKU,
    name: "E2E Test Sofa Cushion",
    itemType: "sub_assembly",
    category: "E2E",
    sourceFile: E2E_SOURCE_FILE,
    uom: "ea",
    variantId: 91003,
  });
  await upsertMapping({
    sku: E2E_FABRIC_SKU,
    name: "Generic Fabric Placeholder",
    itemType: "raw_material",
    category: "Fabric",
    sourceFile: "e2e-shared",
    uom: "yd",
    variantId: 91004,
  });
  await upsertMapping({
    sku: E2E_POWDER_SKU,
    name: "Generic Powder Placeholder",
    itemType: "raw_material",
    category: "Powder",
    sourceFile: "e2e-shared",
    uom: "lb",
    variantId: 91005,
  });
  await upsertMapping({
    sku: E2E_CAP_SKU,
    name: "2x2 Metal Cap",
    itemType: "raw_material",
    category: "Hardware",
    sourceFile: "e2e-owned",
    uom: "ea",
    variantId: 91006,
  });

  await upsertRawMaterial(E2E_FABRIC_SKU, "Generic Fabric Placeholder", "Fabric", "yd");
  await upsertRawMaterial(E2E_POWDER_SKU, "Generic Powder Placeholder", "Powder", "lb");
  await upsertRawMaterial(E2E_CAP_SKU, "2x2 Metal Cap", "Hardware", "ea");

  await db.insert(finished_goods_catalog).values({
    global_sku: E2E_FG_SKU,
    length: "72",
    depth: "34",
    height: "31",
    msrp: "999",
  });

  await db.insert(product_bom_draft).values([
    {
      parent_sku: E2E_FG_SKU,
      child_sku: E2E_FRAME_SKU,
      quantity: "1.0000",
      scrap_factor: "1.0000",
      unit_of_measure: "ea",
      status: "draft_pending_review",
      source: "heuristic",
      notes: "FG → FRAME",
    },
    {
      parent_sku: E2E_FG_SKU,
      child_sku: E2E_CUSH_SKU,
      quantity: "1.0000",
      scrap_factor: "1.0000",
      unit_of_measure: "ea",
      status: "draft_pending_review",
      source: "heuristic",
      notes: "FG → CUSH",
    },
    {
      parent_sku: E2E_FRAME_SKU,
      child_sku: E2E_POWDER_SKU,
      quantity: "2.5000",
      scrap_factor: "1.0000",
      unit_of_measure: "lb",
      status: "draft_pending_review",
      source: "sketchup_geometry",
      notes: `4ea 34.0in 45/45C LP CUT-SQ2-16-34.0-4545C\n${JSON.stringify({
        cut_list: [
          {
            role: "apron",
            profile: "SQ2-16",
            lengthIn: 34,
            endA: 45,
            endB: 45,
            qtyEa: 4,
            lengthConvention: "long_point",
            sourceName: "apron",
            confidence: "stated",
            drawingPartNumber: "CUT-SQ2-16-34.0-4545C",
          },
        ],
      })}`,
    },
    {
      parent_sku: E2E_CUSH_SKU,
      child_sku: E2E_FABRIC_SKU,
      quantity: "8.0000",
      scrap_factor: "1.0000",
      unit_of_measure: "yd",
      status: "draft_pending_review",
      source: "heuristic",
      notes: "CUSH fabric placeholder",
    },
  ]);

  await db.insert(item_operations_draft).values([
    {
      item_sku: E2E_FG_SKU,
      work_center: "Quality Check",
      sequence: 10,
      run_time_mins: "8",
      status: "draft_pending_review",
      source: "heuristic",
    },
    {
      item_sku: E2E_FRAME_SKU,
      work_center: "Building & Welding",
      sequence: 20,
      run_time_mins: "25",
      status: "draft_pending_review",
      source: "heuristic",
    },
    {
      item_sku: E2E_CUSH_SKU,
      work_center: "Fabric Sewing",
      sequence: 20,
      run_time_mins: "22",
      status: "draft_pending_review",
      source: "heuristic",
    },
  ]);
}

export async function closeFactoryBomE2eDb(): Promise<void> {
  await closeDb();
}

export { getDb };

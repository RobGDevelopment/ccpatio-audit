import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { cad_uploads, item_operations_draft, product_bom_draft, sku_mappings } from "@/server/db/schema";
import { applyAluminumTrack, applyCushionFulfillmentMode } from "@/lib/cad-upload/process-job";
import { instantiateDraftsFromDae } from "@/lib/cad-upload/instantiate-from-dae";
import { eq } from "drizzle-orm";
import { RESOURCE_OPERATION_NAMES } from "@/lib/factory-routing/resources";

describe("Phase 5: Routing Stamp & Manager Protection", () => {
  it("executes a two-pass re-sync and mathematically proves idempotency while protecting manager edits", async () => {
    const db = getDb();
    const ROOT_SKU = "TEST-ALUM-TRACK";
    const CHILD_SKU = "TEST-ALUM-SUB";
    const METAL_SKU = "RM-MET-2X2-TUBING";

    // Clean up
    await db.delete(item_operations_draft).where(eq(item_operations_draft.item_sku, CHILD_SKU));
    await db.delete(item_operations_draft).where(eq(item_operations_draft.item_sku, ROOT_SKU));
    await db.delete(product_bom_draft).where(eq(product_bom_draft.parent_sku, CHILD_SKU));
    await db.delete(product_bom_draft).where(eq(product_bom_draft.parent_sku, ROOT_SKU));
    
    // Satisfy FKs
    await db.insert(sku_mappings).values({
      global_sku: ROOT_SKU,
      category: "Geometry",
      item_type: "finished_good",
      original_name: ROOT_SKU,
      source_file: "test",
      is_active: true
    }).onConflictDoNothing();

    await db.insert(sku_mappings).values({
      global_sku: CHILD_SKU,
      category: "Geometry",
      item_type: "finished_good",
      original_name: CHILD_SKU,
      source_file: "test",
      is_active: true
    }).onConflictDoNothing();

    await db.insert(sku_mappings).values({
      global_sku: METAL_SKU,
      category: "Raw Material",
      item_type: "raw_material",
      original_name: METAL_SKU,
      source_file: "test",
      is_active: true
    }).onConflictDoNothing();
    
    // Add hierarchical BOM: ROOT -> CHILD -> METAL
    await db.insert(product_bom_draft).values({
      parent_sku: ROOT_SKU,
      child_sku: CHILD_SKU,
      quantity: "1",
      scrap_factor: "1",
      unit_of_measure: "ea",
      status: "draft_pending_review",
      source: "sketchup_geometry",
      notes: "test",
      cut_list: []
    });

    await db.insert(product_bom_draft).values({
      parent_sku: CHILD_SKU,
      child_sku: METAL_SKU,
      quantity: "1",
      scrap_factor: "1",
      unit_of_measure: "ft",
      status: "draft_pending_review",
      source: "sketchup_geometry",
      notes: "test metal",
      cut_list: []
    });

    // Padded shop-floor name. Trim + alias must collapse this onto FAB POD A.
    const relocatedCenter = " Fabrication & Welding ";
    await db.insert(item_operations_draft).values({
      item_sku: CHILD_SKU,
      work_center: relocatedCenter,
      sequence: 25,
      setup_time_mins: "5.0000",
      run_time_mins: "20.0000",
      status: "factory_approved",
      source: "manager",
      notes: "Relocated Fab"
    });

    // PASS 1
    await applyAluminumTrack(ROOT_SKU);

    let ops = await db.select().from(item_operations_draft).where(eq(item_operations_draft.item_sku, CHILD_SKU));
    
    // Verify track stamped on CHILD_SKU
    const seq10 = ops.find(o => o.sequence === 10);
    expect(seq10).toBeDefined();
    expect(seq10?.work_center).toBe("Metal Cutting");
    expect(seq10?.source).toBe("sketchup_geometry");
    expect(seq10?.setup_time_mins).toBe("0.0000");

    // Sequence 20 is the track's FAB POD A step. The padded legacy name blocks it.
    const seq20 = ops.find(o => o.sequence === 20);
    expect(seq20).toBeUndefined();

    // Verify manager edit is untouched
    const seq25 = ops.find(o => o.sequence === 25);
    expect(seq25).toBeDefined();
    expect(seq25?.work_center).toBe(relocatedCenter);
    expect(seq25?.source).toBe("manager");
    expect(seq25?.status).toBe("factory_approved");
    expect(seq25?.run_time_mins).toBe("20.0000");

    // Mock live Katana sync payload (assert Katana mapping)
    const katanaPayload = ops.map(op => ({
      operation_name: RESOURCE_OPERATION_NAMES[op.work_center as keyof typeof RESOURCE_OPERATION_NAMES] || op.work_center,
      resource_name: op.work_center,
      setup_time: parseFloat(op.setup_time_mins!) * 60, // minutes -> seconds
      run_time: parseFloat(op.run_time_mins!) * 60
    }));
    
    const mcOp = katanaPayload.find(k => k.resource_name === "Metal Cutting");
    expect(mcOp?.operation_name).toBe("Cold Saw Fabrication"); // Prove Katana Mapping

    // PASS 2 - Mathematical Idempotency
    await applyAluminumTrack(ROOT_SKU);

    const opsPass2 = await db.select().from(item_operations_draft).where(eq(item_operations_draft.item_sku, CHILD_SKU));
    
    // Total row count should be exactly the same
    expect(opsPass2.length).toBe(ops.length);
    
    // And statuses shouldn't be overridden
    const seq25Pass2 = opsPass2.find(o => o.sequence === 25);
    expect(seq25Pass2?.status).toBe("factory_approved");
    
    // Enforce Pass 2 Assertions: manager's run_time_mins and work_center values exactly match Pass 1
    expect(seq25Pass2?.run_time_mins).toBe(seq25?.run_time_mins);
    expect(seq25Pass2?.work_center).toBe(seq25?.work_center);
    expect(seq25Pass2?.source).toBe("manager");

    const seq10Pass2 = opsPass2.find(o => o.sequence === 10);
    expect(seq10Pass2?.setup_time_mins).toBe("0.0000");
    expect(seq10Pass2?.work_center).toBe("Metal Cutting");
    expect(seq10Pass2?.source).toBe("sketchup_geometry");
  });

  it("tests cushion lock and BOM guard", async () => {
    const db = getDb();
    const TEST_SKU = "TEST-GUARD-SKU-CUSH";
    const TUBE_SKU = "RM-MET-2X2-TUBING";
    const PKG_SKU = "RM-PKG-CORRUGATE-OS";

    for (const sku of [TEST_SKU, TUBE_SKU, PKG_SKU]) {
      await db.insert(sku_mappings).values({
        global_sku: sku,
        category: "Geometry",
        item_type: sku.startsWith("RM-") ? "raw_material" : "finished_good",
        original_name: sku,
        source_file: "test",
        is_active: true
      }).onConflictDoNothing();
    }

    await db.delete(cad_uploads).where(eq(cad_uploads.global_sku, TEST_SKU));
    await db.delete(item_operations_draft).where(eq(item_operations_draft.item_sku, TEST_SKU));
    await db.delete(product_bom_draft).where(eq(product_bom_draft.parent_sku, TEST_SKU));

    await db.insert(cad_uploads).values({
      global_sku: TEST_SKU,
      storage_path: "test/guard-cush.glb",
      original_filename: "guard-cush.glb",
      ext: "glb",
      status: "draft_ready",
      geometry_snapshot: {
        cushionAabb: { min: [0, 0, 0], max: [24, 18, 6] },
      },
    });

    await db.insert(item_operations_draft).values({
      item_sku: TEST_SKU,
      sequence: 30,
      work_center: "Cushion Stuffing",
      setup_time_mins: "1.0000",
      run_time_mins: "2.0000",
      status: "edited",
      source: "sketchup_geometry",
    });

    await db.insert(product_bom_draft).values({
      parent_sku: TEST_SKU,
      child_sku: PKG_SKU,
      quantity: "9.0000",
      scrap_factor: "1",
      unit_of_measure: "ea",
      status: "edited",
      source: "sketchup_geometry",
      notes: "keep",
      cut_list: [],
    });

    await applyCushionFulfillmentMode(TEST_SKU, "standard");
    const cushionOps = await db.select().from(item_operations_draft).where(eq(item_operations_draft.item_sku, TEST_SKU));
    const seq30 = cushionOps.find(o => o.sequence === 30);
    expect(seq30?.status).toBe("edited");
    expect(seq30?.setup_time_mins).toBe("1.0000");
    expect(seq30?.run_time_mins).toBe("2.0000");

    const packaging = await db.select().from(product_bom_draft).where(eq(product_bom_draft.parent_sku, TEST_SKU));
    const kept = packaging.find(b => b.child_sku === PKG_SKU);
    expect(kept?.status).toBe("edited");
    expect(kept?.quantity).toBe("9.0000");

    await db.delete(product_bom_draft).where(eq(product_bom_draft.parent_sku, TEST_SKU));
    await db.insert(product_bom_draft).values({
      parent_sku: TEST_SKU,
      child_sku: TUBE_SKU,
      quantity: "5.0000",
      scrap_factor: "1",
      unit_of_measure: "ea",
      status: "edited",
      source: "sketchup_geometry",
      cut_list: [],
    });

    const result = await instantiateDraftsFromDae({
      xml: `
        <COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
          <asset>
            <unit name="inch" meter="0.0254"/>
          </asset>
          <library_geometries>
            <geometry id="tube-geom">
              <mesh>
                <source id="tube-positions">
                  <float_array id="tube-positions-array" count="24">
                    0 0 0
                    34 0 0
                    34 2 0
                    0 2 0
                    0 0 2
                    34 0 2
                    34 2 2
                    0 2 2
                  </float_array>
                </source>
              </mesh>
            </geometry>
          </library_geometries>
          <library_visual_scenes>
            <visual_scene id="scene">
              <node id="rail" name="SEAT FRAME">
                <instance_geometry url="#tube-geom"/>
              </node>
            </visual_scene>
          </library_visual_scenes>
        </COLLADA>
      `,
      sourceLabel: "test.dae",
      globalSku: TEST_SKU
    });

    expect(result.criticOk).toBe(true);
    expect(result.linesWritten).toBeGreaterThan(0);

    const bomDrafts = await db.select().from(product_bom_draft).where(eq(product_bom_draft.parent_sku, TEST_SKU));
    const tube = bomDrafts.find(b => b.child_sku === TUBE_SKU);
    expect(tube?.status).toBe("edited");
    expect(tube?.quantity).toBe("5.0000");
  });
});

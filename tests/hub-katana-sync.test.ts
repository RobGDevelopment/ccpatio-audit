import { describe, expect, it } from "vitest";
import {
  indexLiveKatanaVariants,
  planGhostArchives,
  planOperationSync,
  summarizeGhostPlan,
  summarizeOpsPlan,
  trackStepsToInserts,
  type HubSkuSnapshot,
} from "@/lib/hub-katana-sync";
import { getStandardTrack } from "@/lib/factory-routing/resources";

const hub = (
  sku: string,
  opts: Partial<HubSkuSnapshot> = {},
): HubSkuSnapshot => ({
  sku,
  name: opts.name ?? sku,
  itemType: opts.itemType ?? "finished_good",
  isActive: opts.isActive ?? true,
});

describe("indexLiveKatanaVariants", () => {
  it("drops deleted / empty SKUs and keeps first duplicate", () => {
    const { allSkus, products, bySku } = indexLiveKatanaVariants([
      { id: 1, sku: "fin-a", product_id: 10, name: "A" },
      { id: 2, sku: "FIN-A", product_id: 11, name: "dup" },
      { id: 3, sku: "RM-MET-2X2", material_id: 50, name: "tube" },
      { id: 4, sku: "GONE", product_id: 12, deleted_at: "2026-09-01" },
      { id: 5, sku: "  ", product_id: 13 },
    ]);
    expect([...allSkus].sort()).toEqual(["FIN-A", "RM-MET-2X2"]);
    expect(products.map((p) => p.sku)).toEqual(["FIN-A"]);
    expect(bySku.get("FIN-A")?.name).toBe("A");
    expect(bySku.get("RM-MET-2X2")?.productId).toBeNull();
  });
});

describe("planGhostArchives", () => {
  it("archives Hub SKUs missing from live Katana", () => {
    const plan = planGhostArchives(
      [
        hub("FIN-LIVE"),
        hub("FIN-GHOST"),
        hub("FIN-OLD", { isActive: false }),
        hub("RM-MET-2X2", { itemType: "raw_material" }),
        hub("FIN-SLEEP", { isActive: false }),
      ],
      new Set(["FIN-LIVE", "RM-MET-2X2", "FIN-SLEEP"]),
    );
    const bySku = Object.fromEntries(plan.map((r) => [r.sku, r.action]));
    expect(bySku["FIN-LIVE"]).toBe("keep_active");
    expect(bySku["FIN-GHOST"]).toBe("archive");
    expect(bySku["FIN-OLD"]).toBe("already_inactive");
    expect(bySku["RM-MET-2X2"]).toBe("keep_active");
    expect(bySku["FIN-SLEEP"]).toBe("reactivate");
    expect(summarizeGhostPlan(plan)).toMatchObject({
      archive: 1,
      reactivate: 1,
      keepActive: 2,
      alreadyInactive: 1,
    });
  });
});

describe("planOperationSync", () => {
  it("upserts SMV tracks for live products that exist on the Hub", () => {
    const hubBySku = new Map([
      ["ASM-X-FRAME", hub("ASM-X-FRAME", { itemType: "sub_assembly" })],
      ["ASM-X-CUSH", hub("ASM-X-CUSH", { itemType: "sub_assembly" })],
      ["FIN-X", hub("FIN-X")],
    ]);
    const { rows, inserts } = planOperationSync(
      [
        { sku: "ASM-X-FRAME", name: "Frame", variantId: 1, productId: 10, materialId: null },
        { sku: "ASM-X-CUSH", name: "Cush", variantId: 2, productId: 11, materialId: null },
        { sku: "FIN-X", name: "FG", variantId: 3, productId: 12, materialId: null },
        { sku: "FIN-MISSING", name: "Ghost FG", variantId: 4, productId: 13, materialId: null },
      ],
      hubBySku,
    );

    const bySku = Object.fromEntries(rows.map((r) => [r.sku, r]));
    expect(bySku["ASM-X-FRAME"]?.action).toBe("upsert");
    expect(bySku["ASM-X-FRAME"]?.trackId).toBe("aluminum_frame");
    expect(bySku["ASM-X-CUSH"]?.trackId).toBe("cushion");
    expect(bySku["FIN-X"]?.trackId).toBe("final_assembly");
    expect(bySku["FIN-MISSING"]?.action).toBe("skip_missing_hub");

    const frameSteps = getStandardTrack("aluminum_frame");
    expect(bySku["ASM-X-FRAME"]?.steps).toBe(frameSteps.length);
    expect(inserts.filter((i) => i.itemSku === "ASM-X-FRAME")).toHaveLength(
      frameSteps.length,
    );
    expect(inserts.find((i) => i.workCenter === "FAB POD A")?.runTimeMins).toBe(
      "76.3000",
    );
    expect(summarizeOpsPlan(rows).skipMissingHub).toBe(1);
  });

  it("skips raw-material Hub types even if Katana still has a product_id", () => {
    const { rows, inserts } = planOperationSync(
      [
        {
          sku: "RM-MET-2X2-TUBING",
          name: "tube",
          variantId: 9,
          productId: 99,
          materialId: null,
        },
      ],
      new Map([
        [
          "RM-MET-2X2-TUBING",
          hub("RM-MET-2X2-TUBING", { itemType: "raw_material" }),
        ],
      ]),
    );
    expect(rows[0]?.action).toBe("skip_no_track");
    expect(rows[0]?.reason).toBe("item_type_raw_material");
    expect(inserts).toEqual([]);
  });

  it("formats track minutes with four decimal places", () => {
    const inserts = trackStepsToInserts(
      "asm-x-frame",
      getStandardTrack("aluminum_frame"),
    );
    expect(inserts[0]?.itemSku).toBe("ASM-X-FRAME");
    expect(inserts.every((i) => /^\d+\.\d{4}$/.test(i.runTimeMins))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COMMERCE_OWNED_FIELDS,
  buildOwnershipPatch,
  planVariantHeals,
  planNewIngestions,
  runBatchWithIsolation,
  classifyIngestItemType,
  finishCategoryForSku,
  KATANA_RECONCILE_EVENT,
  type HubMappingRow,
  type LiveKatanaVariant,
} from "@/server/katana/catalog-reconcile";
import {
  assertMakeFurniturePriceFloor,
  checkMakeFurniturePriceFloor,
  isMakeFurnitureSku,
  MakeFurniturePriceFloorError,
  MAKE_FURNITURE_MIN_REGULAR_PRICE,
} from "@/server/woocommerce/make-furniture-price-floor";
import {
  buildSurgicalWooPayload,
  pushParentToWoo,
  type HubParentInput,
} from "@/server/woocommerce/woo-catalog-sync";
import { inngestFunctions } from "@/inngest/functions";
import { katanaCatalogReconcile } from "@/inngest/katana-catalog-reconcile";
import { opsKeepaliveMonitor } from "@/inngest/ops-keepalive-monitor";

const ROOT = process.cwd();

function optsOf(fn: unknown): Record<string, unknown> {
  const opts = (fn as { opts?: Record<string, unknown> })?.opts;
  return opts && typeof opts === "object" ? opts : {};
}

function hub(
  partial: Partial<HubMappingRow> & { globalSku: string },
): HubMappingRow {
  return {
    katanaVariantId: null,
    katanaMaterialId: null,
    baseCost: null,
    isActive: true,
    syncToWoo: false,
    itemType: "finished_good",
    attributes: {},
    version: 1,
    ...partial,
  };
}

function live(
  partial: Partial<LiveKatanaVariant> & { id: number; sku: string },
): LiveKatanaVariant {
  return {
    name: partial.sku,
    productId: 1,
    materialId: null,
    purchasePrice: 12.5,
    deletedAt: null,
    ...partial,
  };
}

describe("field-level ownership (Ingest Everything, Auto-Publish Nothing)", () => {
  it("strips aluminum_msrp / sale_price / sync_to_woo / is_web_visible / 3D URLs from patches", () => {
    const patch = buildOwnershipPatch("FIN-BRV-CHR-CLUB", {
      katana_variant_id: 99,
      base_cost: "40.0000",
      aluminum_msrp: "2530.00",
      sale_price: "1999.00",
      sync_to_woo: true,
      is_web_visible: true,
      model_3d_glb_url: "https://cdn.example/model.glb",
    });
    expect(patch.set).toEqual({
      katana_variant_id: 99,
      base_cost: "40.0000",
    });
    expect(patch.forbiddenKeysTouched).toEqual(
      expect.arrayContaining([
        "aluminum_msrp",
        "sale_price",
        "sync_to_woo",
        "is_web_visible",
        "model_3d_glb_url",
      ]),
    );
    for (const field of COMMERCE_OWNED_FIELDS) {
      expect(Object.keys(patch.set)).not.toContain(field);
    }
  });

  it("never proposes commerce keys even when only those are supplied", () => {
    const patch = buildOwnershipPatch("FIN-X", {
      aluminum_msrp: "100",
      sync_to_woo: true,
    });
    expect(patch.set).toEqual({});
    expect(patch.forbiddenKeysTouched.length).toBeGreaterThan(0);
  });
});

describe("deleted+recreated katana_variant_id auto-heal", () => {
  it("rebounds Hub SKU when stored variant is soft-deleted and a live SKU match exists", () => {
    const plans = planVariantHeals(
      [hub({ globalSku: "fin-brv-chr-club", katanaVariantId: 10 })],
      new Map([
        [
          10,
          live({
            id: 10,
            sku: "FIN-BRV-CHR-CLUB",
            deletedAt: "2026-11-01T00:00:00.000Z",
          }),
        ],
      ]),
      new Map([
        ["FIN-BRV-CHR-CLUB", live({ id: 55, sku: "FIN-BRV-CHR-CLUB", purchasePrice: 90 })],
      ]),
    );
    expect(plans).toEqual([
      {
        sku: "FIN-BRV-CHR-CLUB",
        oldVariantId: 10,
        newVariantId: 55,
        materialId: null,
        reason: "stale_deleted_variant_rebound",
      },
    ]);
  });

  it("skips heal when Hub variant id is still live", () => {
    const plans = planVariantHeals(
      [hub({ globalSku: "FIN-OK", katanaVariantId: 7 })],
      new Map([[7, live({ id: 7, sku: "FIN-OK" })]]),
      new Map([["FIN-OK", live({ id: 7, sku: "FIN-OK" })]]),
    );
    expect(plans).toEqual([]);
  });
});

describe("prefix-agnostic ingest + batch isolation", () => {
  it("plans new factory items with sow_phase-ready metadata (finish assets for FAB/PWD/DEC)", () => {
    const plans = planNewIngestions(
      [
        live({ id: 1, sku: "FIN-NEW-CHAIR", name: "New Chair" }),
        live({ id: 2, sku: "FAB-NEW-ASH", name: "New Ash", materialId: 9, productId: null }),
        live({ id: 3, sku: "PWD-NEW-BLACK", name: "New Black", materialId: 10, productId: null }),
        live({ id: 4, sku: "DEC-NEW-KAIROS", name: "Kairos", materialId: 11, productId: null }),
        live({ id: 5, sku: "FIN-ALREADY", name: "Exists" }),
      ],
      new Set(["FIN-ALREADY"]),
    );
    expect(plans.map((p) => p.sku).sort()).toEqual([
      "DEC-NEW-KAIROS",
      "FAB-NEW-ASH",
      "FIN-NEW-CHAIR",
      "PWD-NEW-BLACK",
    ]);
    expect(plans.find((p) => p.sku === "FIN-NEW-CHAIR")?.itemType).toBe("finished_good");
    expect(finishCategoryForSku("FAB-NEW-ASH")).toBe("fabric");
    expect(finishCategoryForSku("PWD-NEW-BLACK")).toBe("powder");
    expect(finishCategoryForSku("DEC-NEW-KAIROS")).toBe("dekton");
    expect(classifyIngestItemType("ASM-X-FRAME")).toBe("sub_assembly");
  });

  it("malformed Katana SKUs do not abort the batch", async () => {
    const seen: string[] = [];
    const result = await runBatchWithIsolation(
      [
        { sku: "FIN-GOOD" },
        { sku: "!!!-BAD" },
        { sku: "FIN-ALSO-GOOD" },
      ],
      async (item) => {
        if (item.sku.includes("BAD")) throw new Error("malformed shop-floor SKU");
        seen.push(item.sku);
      },
    );
    expect(seen).toEqual(["FIN-GOOD", "FIN-ALSO-GOOD"]);
    expect(result.ok).toBe(2);
    expect(result.errors).toEqual([
      { sku: "!!!-BAD", error: "malformed shop-floor SKU" },
    ]);
  });
});

describe("Make furniture price-floor circuit breaker", () => {
  it("classifies Make furniture vs Cabana pillows / covers", () => {
    expect(isMakeFurnitureSku("FIN-BRV-CHR-CLUB", "Bravada Club Chair")).toBe(true);
    expect(isMakeFurnitureSku("FIN-CAB-MIS-17X17", "Square Pillow 17")).toBe(false);
    expect(isMakeFurnitureSku("FIN-ESY-MIS-WEATHERPROOFCO", "Umbrella Cover")).toBe(false);
    expect(isMakeFurnitureSku("3P-TENJAM-CHAIR", "Tenjam")).toBe(false);
  });

  it("blocks <$250 Make furniture while $65 Cabana pillows pass", () => {
    const blocked = checkMakeFurniturePriceFloor({
      sku: "FIN-BRV-CHR-CLUB",
      regularPrice: 25,
      productName: "Bravada Club Chair",
    });
    expect(blocked?.regularPrice).toBe(25);
    expect(blocked?.reason).toMatch(/below the \$250/);

    const zero = checkMakeFurniturePriceFloor({
      sku: "FIN-BRV-CHR-CLUB",
      regularPrice: 0,
    });
    expect(zero).not.toBeNull();

    const pillow = checkMakeFurniturePriceFloor({
      sku: "FIN-CAB-MIS-17X17",
      regularPrice: 65,
      productName: "Square Pillow 17",
    });
    expect(pillow).toBeNull();

    const ok = checkMakeFurniturePriceFloor({
      sku: "FIN-BRV-CHR-CLUB",
      regularPrice: MAKE_FURNITURE_MIN_REGULAR_PRICE,
    });
    expect(ok).toBeNull();
  });

  it("buildSurgicalWooPayload / pushParentToWoo refuse sub-floor Make furniture", async () => {
    const parent: HubParentInput = {
      sku: "FIN-BRV-CHR-CLUB",
      name: "Bravada Club Chair",
      status: "publish",
      variations: [
        {
          sku: "FIN-BRV-CHR-CLUB",
          regularPrice: 25,
          weightLb: 40,
          lengthIn: 30,
          widthIn: 30,
          heightIn: 30,
          makeOrResale: "Make",
        },
      ],
    };
    expect(() =>
      buildSurgicalWooPayload(parent, { weightUnit: "lb", dimensionUnit: "in" }),
    ).toThrow(MakeFurniturePriceFloorError);

    await expect(
      pushParentToWoo(parent, { dryRun: true }),
    ).rejects.toBeInstanceOf(MakeFurniturePriceFloorError);

    const pillowParent: HubParentInput = {
      sku: "FIN-CAB-MIS-17X17",
      name: "Square Pillow 17",
      status: "publish",
      variations: [
        {
          sku: "FIN-CAB-MIS-17X17",
          regularPrice: 65,
          weightLb: 2,
          lengthIn: 17,
          widthIn: 17,
          heightIn: 6,
          makeOrResale: "Make",
        },
      ],
    };
    expect(() =>
      assertMakeFurniturePriceFloor({
        parentSku: pillowParent.sku,
        parentName: pillowParent.name,
        variations: pillowParent.variations,
      }),
    ).not.toThrow();
    const built = buildSurgicalWooPayload(pillowParent, {
      weightUnit: "lb",
      dimensionUnit: "in",
    });
    expect(built.variationBatch.create[0]?.regular_price).toBe("65.00");
  });
});

describe("Inngest registration", () => {
  it("registers katana-catalog-reconcile with 2h cron + manual event + throttle", () => {
    expect(inngestFunctions).toContain(katanaCatalogReconcile);
    const opts = optsOf(katanaCatalogReconcile);
    expect(opts.id).toBe("katana-catalog-reconcile");
    const triggers = opts.triggers as Array<Record<string, unknown>>;
    expect(triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cron: "0 */2 * * *" }),
        expect.objectContaining({ event: KATANA_RECONCILE_EVENT }),
      ]),
    );
    expect(opts.throttle).toEqual({ limit: 30, period: "1m" });
    const concurrency = opts.concurrency;
    const entries = Array.isArray(concurrency) ? concurrency : [concurrency];
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ limit: 1 }),
        expect.objectContaining({ key: '"katana-tenant"', limit: 1 }),
      ]),
    );
  });

  it("registers ops-keepalive-monitor daily at 11:00 UTC", () => {
    expect(inngestFunctions).toContain(opsKeepaliveMonitor);
    const opts = optsOf(opsKeepaliveMonitor);
    expect(opts.id).toBe("ops-keepalive-monitor");
    expect(opts.triggers).toEqual(
      expect.arrayContaining([expect.objectContaining({ cron: "0 11 * * *" })]),
    );
  });
});

describe("source contracts", () => {
  it("master-catalog ships System Health pill + drawer wiring", () => {
    const page = readFileSync(
      join(ROOT, "src/app/embed/admin/master-catalog/page.tsx"),
      "utf8",
    );
    expect(page).toContain("system-health-pill");
    expect(page).toContain("SystemHealthDrawer");
    expect(page).toContain("getSystemHealthAction");
    const drawer = readFileSync(
      join(ROOT, "src/app/embed/admin/master-catalog/ecommerce/SystemHealthDrawer.tsx"),
      "utf8",
    );
    expect(drawer).toContain("Run Self-Heal Sync Now");
    expect(drawer).toContain("Re-Verify SKU & Replay Order");
    expect(drawer).toContain("Pass-the-Baton Operator Guide");
  });

  it("keepalive uses getMutexDb for QBO freshness", () => {
    const src = readFileSync(join(ROOT, "src/server/ops/keepalive.ts"), "utf8");
    expect(src).toContain("getMutexDb");
    expect(src).toContain("withQboRefreshLock");
    expect(src).toContain("OPS_ALERT_EMAILS");
    expect(src).toContain("KATANA_SYNC_STALE_MS");
  });
});

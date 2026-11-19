import { describe, expect, it } from "vitest";
import {
  BRAVADA_CLUB_ALU110,
  BRAVADA_CLUB_STEEL,
  BRAVADA_LOVESEAT_ALU110,
  BRAVADA_LOVESEAT_STEEL,
  BRAVADA_SWIVEL_ALU110,
  BRAVADA_SWIVEL_STEEL,
  CABANA_PILLOW_SKUS,
  classifyFramePolicy,
  computeAluMsrp,
  DEFAULT_ALU_UPCHARGE_PCT,
  FRAME_POLICY_ALU10,
  FRAME_POLICY_NOT_APPLICABLE,
  FRAME_POLICY_RESALE,
  hasHalfCent,
  STEEL_DISCONTINUED_REASON,
  TAYLOR_HALF_CENT_STEEL,
  WEB_ALUMINUM_ONLY_STAMP,
  wooEcommercePrice,
} from "@/server/ecommerce/alu10-pricing";
import { autoWooAluminumPrice } from "@/server/ecommerce/auto-sku-engine";
import {
  assertNoRegression,
  parseMoney,
} from "@/server/ecommerce/phase2-hydration";
import {
  buildMiaAluminumPriceListCsv,
  STOREFRONT_POLICY_BANNER,
} from "@/server/ecommerce/two-tab-portal";
import {
  isAluminumFrameMaterial,
  isSteelFrameMaterial,
  MET_ALUM_SKU,
  normalizeFrameMaterialValue,
} from "@/server/woocommerce/finish-keys";
import { resolveWooOrder } from "@/server/woocommerce/sku-resolver";
import { mapWooOrderToKatanaSalesOrder } from "@/lib/katana";
import { wooAluminumWeldStamp } from "@/inngest/woo-order";
import {
  BASE_SKU,
  FAB_SKU,
  makeHub,
  PWD_SKU,
  skuRecord,
  wooLine,
  wooOrder,
} from "./helpers/woo-fakes";
import { loadPhase1SowRows } from "../scripts/ops/enable-phase1-hub-data";

describe("alu10 pricing math", () => {
  it("computes Bravada Club / Swivel / Loveseat at +10%", () => {
    expect(computeAluMsrp(BRAVADA_CLUB_STEEL)).toBe(BRAVADA_CLUB_ALU110);
    expect(computeAluMsrp(BRAVADA_SWIVEL_STEEL)).toBe(BRAVADA_SWIVEL_ALU110);
    expect(computeAluMsrp(BRAVADA_LOVESEAT_STEEL)).toBe(BRAVADA_LOVESEAT_ALU110);
    expect(DEFAULT_ALU_UPCHARGE_PCT).toBe(10);
  });

  it("keeps Cabana pillows and resale at 1.00x", () => {
    expect(
      wooEcommercePrice({
        steelMsrp: 65,
        framePolicy: FRAME_POLICY_NOT_APPLICABLE,
      }),
    ).toBe(65);
    expect(
      wooEcommercePrice({
        steelMsrp: 95,
        framePolicy: FRAME_POLICY_NOT_APPLICABLE,
      }),
    ).toBe(95);
    expect(
      wooEcommercePrice({
        steelMsrp: 499.99,
        framePolicy: FRAME_POLICY_RESALE,
      }),
    ).toBe(499.99);
  });

  it("flags Taylor .50 cent Aluminum prices", () => {
    for (const row of TAYLOR_HALF_CENT_STEEL) {
      const alu = computeAluMsrp(row.steel);
      expect(alu).toBe(row.alu110);
      expect(hasHalfCent(alu)).toBe(true);
    }
  });

  it("classifies frame policies for Phase 1 SKUs", () => {
    expect(classifyFramePolicy({ globalSku: "FIN-BRV-CLB-CHA-34X34" })).toBe(
      FRAME_POLICY_ALU10,
    );
    expect(classifyFramePolicy({ globalSku: CABANA_PILLOW_SKUS[0] })).toBe(
      FRAME_POLICY_NOT_APPLICABLE,
    );
    expect(classifyFramePolicy({ globalSku: "FIN-TJM-CHA", isThirdParty: true })).toBe(
      FRAME_POLICY_RESALE,
    );
  });

  it("auto-computes Woo Aluminum for metal-framed Make wizard (Mia nearest-$5)", () => {
    const priced = autoWooAluminumPrice({
      origin: "manufactured",
      steelBaseMsrp: 2080,
      metalFramedMake: true,
    });
    expect(priced.wooPrice).toBe(2290);
    expect(priced.framePolicy).toBe(FRAME_POLICY_ALU10);
  });
});

describe("Phase 1 SOW metal / pillow / resale counts", () => {
  it("covers 88 metal + 3 pillows + 11 resale-ish SOW rows at correct multipliers", () => {
    const sow = loadPhase1SowRows();
    expect(sow.length).toBe(102);

    let metal = 0;
    let pillow = 0;
    let resale = 0;
    for (const row of sow) {
      const steel = Number(parseMoney(row.msrp));
      const policy = classifyFramePolicy({
        globalSku: row.sku,
        isThirdParty:
          row.sku.startsWith("FIN-KIN-") ||
          row.sku.startsWith("FIN-TJM-") ||
          row.sku === "FIN-MLN-UMB" ||
          row.sku === "FIN-CAN-UMB",
      });
      const woo = wooEcommercePrice({ steelMsrp: steel, framePolicy: policy })!;
      if (policy === FRAME_POLICY_ALU10) {
        metal += 1;
        expect(woo).toBe(computeAluMsrp(steel));
      } else if (policy === FRAME_POLICY_NOT_APPLICABLE) {
        pillow += 1;
        expect(woo).toBe(steel);
      } else {
        resale += 1;
        expect(woo).toBe(steel);
      }
    }
    expect(metal).toBe(88);
    expect(pillow).toBe(3);
    expect(resale).toBe(11);
  });
});

describe("frame material normalize + Aluminum-only resolver", () => {
  it("normalizes Aluminum / Steel labels", () => {
    expect(normalizeFrameMaterialValue("Aluminum")).toBe(MET_ALUM_SKU);
    expect(normalizeFrameMaterialValue("Steel")).toBe("MET-STEEL");
    expect(isAluminumFrameMaterial("Aluminum")).toBe(true);
    expect(isSteelFrameMaterial("MET-STEEL")).toBe(true);
  });

  it("defaults missing frame_material to MET-ALUM and stamps Katana SO notes", async () => {
    const hub = makeHub();
    hub.records.set(
      BASE_SKU,
      skuRecord(BASE_SKU, {
        itemType: "finished_good",
        syncToWoo: true,
        attributes: { frame_policy: FRAME_POLICY_ALU10 },
        hasCatalogRow: true,
        hasActiveListing: true,
        katanaVariantId: 100,
      }),
    );
    const result = await resolveWooOrder(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "fabric", value: FAB_SKU },
              { key: "powder_coat", value: PWD_SKU },
              // frame omitted — Aluminum-only default
            ],
          }),
        ],
      }),
      hub,
      { requireKatanaIds: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const frame = result.lines[0]!.finishes.find((f) => f.slot === "frame");
    expect(frame?.sku).toBe(MET_ALUM_SKU);

    const so = mapWooOrderToKatanaSalesOrder(
      wooOrder({ id: 42 }),
      result.lines,
    );
    expect(so.additionalInfo).toContain(WEB_ALUMINUM_ONLY_STAMP);
    expect(wooAluminumWeldStamp(result.lines)).toBe(WEB_ALUMINUM_ONLY_STAMP);
  });

  it("quarantines explicit Steel on Aluminum-only listings", async () => {
    const hub = makeHub();
    hub.records.set(
      BASE_SKU,
      skuRecord(BASE_SKU, {
        itemType: "finished_good",
        syncToWoo: true,
        attributes: { frame_policy: FRAME_POLICY_ALU10 },
        hasCatalogRow: true,
        hasActiveListing: true,
        katanaVariantId: 100,
      }),
    );
    const result = await resolveWooOrder(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "fabric", value: FAB_SKU },
              { key: "powder_coat", value: PWD_SKU },
              { key: "frame_material", value: "Steel" },
            ],
          }),
        ],
      }),
      hub,
      { requireKatanaIds: false },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.message.includes(STEEL_DISCONTINUED_REASON))).toBe(
      true,
    );
  });
});

describe("zero data loss snapshot guard + portal banner", () => {
  it("assertNoRegression catches lost BOM / logistics / catalog counts", () => {
    const before = {
      finished_goods_catalog: { image_url: 62, msrp: 100, rows: 1317 },
      logistics_profiles: { ready_profiles: 930, rows: 2781 },
      ecommerce_listings: { steel_msrp: 200, aluminum_msrp: 0 },
      product_bom: { edges: 3300, parents: 400 },
    };
    const afterOk = {
      finished_goods_catalog: { image_url: 62, msrp: 100, rows: 1317 },
      logistics_profiles: { ready_profiles: 930, rows: 2781 },
      ecommerce_listings: { steel_msrp: 200, aluminum_msrp: 88 },
      product_bom: { edges: 3300, parents: 400 },
    };
    expect(assertNoRegression(before, afterOk)).toEqual([]);
    expect(
      assertNoRegression(before, {
        ...afterOk,
        product_bom: { edges: 3299, parents: 400 },
      }),
    ).toEqual(["product_bom.edges: 3300 → 3299"]);
  });

  it("exports Mia Aluminum price list CSV header", () => {
    expect(STOREFRONT_POLICY_BANNER).toMatch(/Aluminum Only/i);
    expect(STOREFRONT_POLICY_BANNER).toMatch(/Mia PDF/i);
    const csv = buildMiaAluminumPriceListCsv([
      {
        collection: "Bravada",
        product: "Club Chair",
        size: '34" x 34"',
        facing: "",
        sku: "FIN-BRV-CLB-CHA-34X34",
        framePolicy: FRAME_POLICY_ALU10,
        steelBase: 2080,
        aluPrice: 2530,
        salePrice: null,
        miaApproved: true,
      },
    ]);
    expect(csv).toContain("Steel Base MSRP");
    expect(csv).toContain("2530.00");
    expect(csv).toContain("Website Price (Aluminum)");
  });
});

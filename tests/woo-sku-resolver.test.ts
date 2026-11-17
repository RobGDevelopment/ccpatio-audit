import { describe, expect, it } from "vitest";
import {
  deriveRecipeSlots,
  isFrameBearingSku,
  resolveWooOrder,
} from "@/server/woocommerce/sku-resolver";
import {
  BASE_SKU,
  DEFAULT_RECIPE,
  FAB_SKU,
  PWD_SKU,
  VARIANT,
  defaultRecords,
  makeHub,
  skuRecord,
  wooLine,
  wooOrder,
} from "./helpers/woo-fakes";

const messages = (r: Awaited<ReturnType<typeof resolveWooOrder>>) =>
  r.ok ? [] : r.issues.map((i) => i.message);

describe("deriveRecipeSlots", () => {
  it("reads the slots a recipe offers from its descendant SKUs", () => {
    expect(deriveRecipeSlots(DEFAULT_RECIPE)).toEqual({
      fabric: true,
      powder_coat: true,
      frame: true,
      dekton: false,
      frameSwappable: false,
      unsupportedPlaceholders: [],
    });
  });

  it("a provisioned RM-FRAME-GENERIC makes the frame swappable", () => {
    const slots = deriveRecipeSlots(["RM-FRAME-GENERIC", "RM-FAB-GENERIC"]);
    expect(slots.frame).toBe(true);
    expect(slots.frameSwappable).toBe(true);
    expect(slots.powder_coat).toBe(false);
  });

  it("recognizes ^FRM- children as frame-bearing modular recipes", () => {
    expect(isFrameBearingSku("FRM-BRK-BAR-36X36")).toBe(true);
    expect(isFrameBearingSku("SA-TST-CHA-FRAME")).toBe(true);
    expect(isFrameBearingSku("CSS-BRV-CUSH")).toBe(false);
    const slots = deriveRecipeSlots(["FRM-BRK-DIN-42X42", "RM-DKT-GENERIC-SLAB"]);
    expect(slots.frame).toBe(true);
    expect(slots.dekton).toBe(true);
    expect(slots.unsupportedPlaceholders).toEqual([]);
  });

  it("RM-DKT-GENERIC-SLAB is a supported dekton placeholder (no false quarantine)", () => {
    expect(deriveRecipeSlots(["RM-DKT-GENERIC-SLAB", "RM-FAB-GENERIC"]).unsupportedPlaceholders).toEqual([]);
    expect(deriveRecipeSlots(["RM-DKT-GENERIC-SLAB", "RM-FAB-GENERIC"]).dekton).toBe(true);
  });

  it("lists placeholders B1 cannot bind", () => {
    expect(deriveRecipeSlots(["RM-UNKNOWN-GENERIC", "RM-FAB-GENERIC"]).unsupportedPlaceholders).toEqual([
      "RM-UNKNOWN-GENERIC",
    ]);
  });
});

describe("resolveWooOrder", () => {
  it("resolves a clean order: fabric and powder swap, frame is attribute-only until a placeholder exists", async () => {
    const result = await resolveWooOrder(wooOrder(), makeHub(), { requireKatanaIds: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [line] = result.lines;
    expect(line!.spec.sku).toBe(BASE_SKU);
    expect(line!.baseVariantId).toBe(VARIANT.base);
    expect(line!.finishes).toEqual([
      { slot: "fabric", sku: FAB_SKU, variantId: VARIANT.fab, placeholderSku: "RM-FAB-GENERIC", genericVariantId: VARIANT.genericFab, mode: "swap" },
      { slot: "powder_coat", sku: PWD_SKU, variantId: VARIANT.pwd, placeholderSku: "RM-PWD-GENERIC", genericVariantId: VARIANT.genericPwd, mode: "swap" },
      { slot: "frame", sku: "MET-ALUM", variantId: VARIANT.alum, placeholderSku: null, genericVariantId: null, mode: "attribute_only" },
    ]);
  });

  it("the frame becomes a swap once the recipe carries RM-FRAME-GENERIC and the hub knows its variant", async () => {
    const hub = makeHub();
    hub.recipes.set(BASE_SKU, [...DEFAULT_RECIPE, "RM-FRAME-GENERIC"]);
    hub.records.set("RM-FRAME-GENERIC", skuRecord("RM-FRAME-GENERIC", { katanaVariantId: 903 }));
    const result = await resolveWooOrder(wooOrder(), hub, { requireKatanaIds: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0]!.finishes.find((f) => f.slot === "frame")).toMatchObject({
      mode: "swap",
      placeholderSku: "RM-FRAME-GENERIC",
      genericVariantId: 903,
    });
  });

  it("live mode requires Katana variant ids for finishes and placeholders; ingress mode does not", async () => {
    const hub = makeHub();
    hub.records.set(FAB_SKU, skuRecord(FAB_SKU, { attributes: { web_sellable: true }, katanaVariantId: null }));
    const live = await resolveWooOrder(wooOrder(), hub, { requireKatanaIds: true });
    expect(messages(live).some((m) => /fabric .* no katana_variant_id/.test(m))).toBe(true);
    const ingress = await resolveWooOrder(wooOrder(), hub, { requireKatanaIds: false });
    expect(ingress.ok).toBe(true);

    const hub2 = makeHub();
    hub2.records.set("RM-PWD-GENERIC", skuRecord("RM-PWD-GENERIC", { katanaVariantId: null }));
    const live2 = await resolveWooOrder(wooOrder(), hub2, { requireKatanaIds: true });
    expect(messages(live2).some((m) => /Placeholder RM-PWD-GENERIC has no katana_variant_id/.test(m))).toBe(true);
  });

  it("a finish with the wrong prefix for its slot is rejected", async () => {
    const hub = makeHub();
    hub.records.set("PWD-BLK", skuRecord("PWD-BLK", { attributes: { web_sellable: true } }));
    const res = await resolveWooOrder(
      wooOrder({ line_items: [wooLine({ meta_data: [{ key: "fabric", value: "PWD-BLK" }, { key: "powder_coat", value: PWD_SKU }, { key: "frame", value: "MET-ALUM" }] })] }),
      hub,
      { requireKatanaIds: false },
    );
    expect(messages(res).some((m) => /fabric must be a FAB-\* SKU/.test(m))).toBe(true);
  });

  it("a finish that is not a raw_material is rejected", async () => {
    const hub = makeHub();
    hub.records.set(FAB_SKU, skuRecord(FAB_SKU, { itemType: "finished_good", attributes: { web_sellable: true } }));
    const res = await resolveWooOrder(wooOrder(), hub, { requireKatanaIds: false });
    expect(messages(res).some((m) => /not a raw_material/.test(m))).toBe(true);
  });

  it("a finish sent for a slot the recipe does not have is rejected", async () => {
    const hub = makeHub();
    hub.recipes.set(BASE_SKU, ["SA-X-FRAME", "RM-FAB-GENERIC"]);
    const res = await resolveWooOrder(wooOrder(), hub, { requireKatanaIds: false });
    expect(messages(res).some((m) => /no powder_coat slot/.test(m))).toBe(true);
  });

  it("the frame is required whenever the recipe has a frame", async () => {
    const res = await resolveWooOrder(
      wooOrder({ line_items: [wooLine({ meta_data: [{ key: "fabric", value: FAB_SKU }, { key: "powder_coat", value: PWD_SKU }] })] }),
      makeHub(),
      { requireKatanaIds: false },
    );
    expect(messages(res).some((m) => /requires a frame finish/.test(m))).toBe(true);
  });

  it("reports every problem of every line, not just the first", async () => {
    const res = await resolveWooOrder(
      wooOrder({ line_items: [wooLine({ id: 1, sku: "NOPE-1" }), wooLine({ id: 2, sku: "NOPE-2" })] }),
      makeHub(),
      { requireKatanaIds: false },
    );
    expect(messages(res)).toHaveLength(2);
  });

  it("recipes are fetched once per distinct base SKU", async () => {
    const hub = makeHub();
    let calls = 0;
    const original = hub.recipeSkus;
    hub.recipeSkus = async (sku) => {
      calls += 1;
      return original(sku);
    };
    const res = await resolveWooOrder(
      wooOrder({ line_items: [wooLine({ id: 1 }), wooLine({ id: 2 }), wooLine({ id: 3 })] }),
      hub,
      { requireKatanaIds: false },
    );
    expect(res.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("an unknown SKU is never looked up in a static dictionary: the hub is the only authority", async () => {
    const records = defaultRecords();
    records.set("FIN-NEW-001", skuRecord("FIN-NEW-001", { itemType: "finished_good", syncToWoo: true, hasCatalogRow: true }));
    const hub = makeHub({ records, recipes: new Map([["FIN-NEW-001", DEFAULT_RECIPE]]) });
    const res = await resolveWooOrder(wooOrder({ line_items: [wooLine({ sku: "FIN-NEW-001" })] }), hub, {
      requireKatanaIds: false,
    });
    expect(res.ok).toBe(true);
  });

  it("resolves sku_aliases (-ALU / -CNT) to the canonical Hub SKU before authority lookup", async () => {
    const hub = makeHub({
      aliases: new Map([
        [`${BASE_SKU}-ALU`, BASE_SKU],
        ["FIN-WFT-FLY-BST-18X18-CNT", BASE_SKU],
      ]),
    });
    const alu = await resolveWooOrder(
      wooOrder({ line_items: [wooLine({ sku: `${BASE_SKU}-ALU` })] }),
      hub,
      { requireKatanaIds: false },
    );
    expect(alu.ok).toBe(true);
    if (!alu.ok) return;
    expect(alu.lines[0]!.spec.sku).toBe(BASE_SKU);

    const cnt = await resolveWooOrder(
      wooOrder({ line_items: [wooLine({ sku: "FIN-WFT-FLY-BST-18X18-CNT" })] }),
      hub,
      { requireKatanaIds: false },
    );
    expect(cnt.ok).toBe(true);
    if (!cnt.ok) return;
    expect(cnt.lines[0]!.spec.sku).toBe(BASE_SKU);
  });

  it("third_party_sources resale skips empty-recipe quarantine and marks skipMo", async () => {
    const resaleSku = "FIN-TJM-TAB";
    const records = defaultRecords();
    records.set(
      resaleSku,
      skuRecord(resaleSku, {
        itemType: "finished_good",
        syncToWoo: true,
        hasCatalogRow: true,
        katanaVariantId: 777,
      }),
    );
    const hub = makeHub({
      records,
      recipes: new Map(),
      thirdParty: new Set([resaleSku]),
    });
    const res = await resolveWooOrder(
      wooOrder({
        line_items: [wooLine({ sku: resaleSku, meta_data: [] })],
      }),
      hub,
      { requireKatanaIds: false },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]!.skipMo).toBe(true);
    expect(res.lines[0]!.finishes).toEqual([]);
  });

  it("mapped ACF add-on SKUs append as extra resolved SO lines; bare '1' quarantines", async () => {
    const addonSku = "FIN-ADD-CASTERS";
    const records = defaultRecords();
    records.set(
      addonSku,
      skuRecord(addonSku, {
        itemType: "finished_good",
        syncToWoo: true,
        hasCatalogRow: true,
        katanaVariantId: 880,
      }),
    );
    const hub = makeHub({ records, thirdParty: new Set([addonSku]) });

    const mapped = await resolveWooOrder(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "fabric", value: FAB_SKU },
              { key: "powder_coat", value: PWD_SKU },
              { key: "frame", value: "MET-ALUM" },
              { key: "casters", value: addonSku },
            ],
          }),
        ],
      }),
      hub,
      { requireKatanaIds: false },
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.lines).toHaveLength(2);
    expect(mapped.lines[0]!.spec.sku).toBe(BASE_SKU);
    expect(mapped.lines[1]!.spec.sku).toBe(addonSku);
    expect(mapped.lines[1]!.skipMo).toBe(true);

    const unmapped = await resolveWooOrder(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "fabric", value: FAB_SKU },
              { key: "powder_coat", value: PWD_SKU },
              { key: "frame", value: "MET-ALUM" },
              { key: "casters", value: "1" },
            ],
          }),
        ],
      }),
      hub,
      { requireKatanaIds: false },
    );
    expect(messages(unmapped).some((m) => /Add-on "casters".*no mapped add-on SKU/.test(m))).toBe(true);
  });
});

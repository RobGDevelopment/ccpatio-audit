import { describe, expect, it } from "vitest";
import { extractWooLineSpecs, wooLineKey } from "@/server/woocommerce/line-specs";
import { BASE_SKU, FAB_SKU, wooLine, wooOrder } from "./helpers/woo-fakes";

describe("extractWooLineSpecs", () => {
  it("extracts sku, quantity and the three finishes (upper-cased) per line", () => {
    const { specs, issues } = extractWooLineSpecs(
      wooOrder({
        line_items: [
          wooLine({
            id: 11,
            sku: ` ${BASE_SKU.toLowerCase()} `,
            quantity: 3,
            meta_data: [
              { key: "fabric", value: ` ${FAB_SKU.toLowerCase()} ` },
              { key: "powder_coat", value: "PWD-BLK" },
              { key: "frame", value: "MET-STEEL" },
            ],
          }),
        ],
      }),
    );
    expect(issues).toEqual([]);
    expect(specs).toEqual([
      {
        index: 0,
        wooLineItemId: 11,
        sku: BASE_SKU,
        quantity: 3,
        finishes: { fabric: FAB_SKU, powder_coat: "PWD-BLK", frame: "MET-STEEL" },
        addons: [],
      },
    ]);
  });

  it("accepts fabric_sku / frame_material aliases as finish slots", () => {
    const { specs, issues } = extractWooLineSpecs(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "fabric_sku", value: FAB_SKU },
              { key: "powder_coat", value: "PWD-BLK" },
              { key: "frame_material", value: "MET-ALUM" },
            ],
          }),
        ],
      }),
    );
    expect(issues).toEqual([]);
    expect(specs[0]!.finishes).toEqual({
      fabric: FAB_SKU,
      powder_coat: "PWD-BLK",
      frame: "MET-ALUM",
    });
  });

  it("parses ACF add-ons: SKU-valued and truthy flags; ignores 0/empty", () => {
    const { specs, issues } = extractWooLineSpecs(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "fabric", value: FAB_SKU },
              { key: "powder_coat", value: "PWD-BLK" },
              { key: "frame", value: "MET-ALUM" },
              { key: "casters", value: "1" },
              { key: "arms", value: "0" },
              { key: "ironwood", value: "" },
              { key: "dekton_sidearm", value: "FIN-ADD-DKT-SIDE" },
              { key: "fly_tables", value: "true" },
            ],
          }),
        ],
      }),
    );
    expect(issues).toEqual([]);
    expect(specs[0]!.addons).toEqual([
      { key: "casters", rawValue: "1", sku: "FIN-ESY-CHS" },
      { key: "dekton_sidearm", rawValue: "FIN-ADD-DKT-SIDE", sku: "FIN-ADD-DKT-SIDE" },
      { key: "fly_tables", rawValue: "true", sku: "FIN-OCN-TAB-34X12" },
    ]);
  });

  it("maps ironwood/umbrella_cover/arms truthy flags to canonical Hub add-on SKUs", () => {
    const { specs, issues } = extractWooLineSpecs(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "ironwood", value: "1" },
              { key: "umbrella_cover", value: "yes" },
              { key: "arms", value: "1" },
            ],
          }),
        ],
      }),
    );
    expect(issues).toEqual([]);
    expect(specs[0]!.addons).toEqual([
      { key: "ironwood", rawValue: "1", sku: "FIN-ESY-MIS-ADDIRONWOOD" },
      { key: "umbrella_cover", rawValue: "yes", sku: "FIN-ESY-MIS-WEATHERPROOFCO" },
      { key: "arms", rawValue: "1", sku: "FIN-ESY-MIS-ARMS" },
    ]);
  });

  it("quarantines custom_welded_fly_table with custom_quote_addon_requires_sales", () => {
    const { specs, issues } = extractWooLineSpecs(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [{ key: "custom_welded_fly_table", value: "1" }],
          }),
        ],
      }),
    );
    expect(specs[0]!.addons).toEqual([]);
    expect(issues.some((i) => i.message.includes("custom_quote_addon_requires_sales"))).toBe(
      true,
    );
  });

  it("ignores facing / select_facing meta without quarantine", () => {
    const { specs, issues } = extractWooLineSpecs(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "fabric", value: FAB_SKU },
              { key: "powder_coat", value: "PWD-BLK" },
              { key: "frame", value: "MET-STEEL" },
              { key: "facing", value: "Left-Side Facing" },
              { key: "pa_select-facing", value: "Right-Side Facing" },
            ],
          }),
        ],
      }),
    );
    expect(issues).toEqual([]);
    expect(specs[0]!.addons).toEqual([]);
    expect(specs[0]!.finishes.fabric).toBe(FAB_SKU);
  });

  it("reports an empty finish value", () => {
    const { issues } = extractWooLineSpecs(
      wooOrder({ line_items: [wooLine({ meta_data: [{ key: "fabric", value: "  " }] })] }),
    );
    expect(issues).toEqual([
      { path: "line_items.0.meta_data.0.value", message: expect.stringContaining('Finish "fabric" is empty') },
    ]);
  });

  it("reports a non-scalar finish value", () => {
    const { issues } = extractWooLineSpecs(
      wooOrder({ line_items: [wooLine({ meta_data: [{ key: "fabric", value: { sku: "FAB-X" } }] })] }),
    );
    expect(issues).toHaveLength(1);
  });

  it("a duplicated key with the same value is fine; with different values it is an issue", () => {
    const same = extractWooLineSpecs(
      wooOrder({ line_items: [wooLine({ meta_data: [{ key: "fabric", value: "FAB-A" }, { key: "pa_fabric", value: "fab-a" }] })] }),
    );
    expect(same.issues).toEqual([]);
    const different = extractWooLineSpecs(
      wooOrder({ line_items: [wooLine({ meta_data: [{ key: "fabric", value: "FAB-A" }, { key: "pa_fabric", value: "FAB-B" }] })] }),
    );
    expect(different.issues).toHaveLength(1);
    expect(different.issues[0]!.message).toContain("given twice");
  });

  it("human APF keys + embedded/display finish values resolve to Hub SKUs", () => {
    const { specs, issues } = extractWooLineSpecs(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              { key: "Select Fabric", value: "Ash (FAB-ACT-ASH)" },
              { key: "Select Powder Coat", value: "Black (PWD-BLACK)" },
            ],
          }),
        ],
      }),
    );
    expect(issues).toEqual([]);
    expect(specs[0]!.finishes.fabric).toBe("FAB-ACT-ASH");
    expect(specs[0]!.finishes.powder_coat).toBe("PWD-BLACK");
  });

  it("strips APF (+$X.XX) suffixes and honors display_key/display_value", () => {
    const { specs, issues } = extractWooLineSpecs(
      wooOrder({
        line_items: [
          wooLine({
            meta_data: [
              {
                key: "pa_fabric",
                display_key: "Select Fabric",
                value: "Ash (+$0.00)",
                display_value: "Ash",
              },
              {
                key: "pa_powder",
                display_key: "Select Powder Coat",
                value: "Black (+$0.00)",
              },
              { key: "umbrella_cover", value: "Yes (+$100.00)" },
              { key: "dekton_sidearm", value: "Dekton Sidearm (+$300.00)" },
              { key: "base_price", value: "Yes (+$150.00)" },
            ],
          }),
        ],
      }),
    );
    expect(issues).toEqual([]);
    expect(specs[0]!.finishes.fabric).toBe("FAB-ACT-ASH");
    expect(specs[0]!.finishes.powder_coat).toBe("PWD-BLACK");
    expect(specs[0]!.addons.map((a) => a.key).sort()).toEqual(
      ["base_price", "dekton_sidearm", "umbrella_cover"].sort(),
    );
    expect(specs[0]!.addons.every((a) => a.sku)).toBe(true);
  });

  it("a rejected near-miss key names the accepted keys in its message", () => {
    const { issues } = extractWooLineSpecs(
      wooOrder({ line_items: [wooLine({ meta_data: [{ key: "stone", value: "DKT-X" }] })] }),
    );
    expect(issues[0]!.message).toContain("fabric, powder_coat, frame, dekton");
    expect(issues[0]!.message).toContain("Use: (not supported)");
  });

  it("finish keys at ORDER level are an issue (ambiguous which line)", () => {
    const { issues } = extractWooLineSpecs(
      wooOrder({ meta_data: [{ key: "fabric", value: "FAB-A" }, { key: "marketing_source", value: "x" }] }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe("meta_data.0.key");
  });

  it("wooLineKey is the Woo line id, or idx<position> when Woo sent none", () => {
    expect(wooLineKey({ index: 2, wooLineItemId: 77 })).toBe("77");
    expect(wooLineKey({ index: 2, wooLineItemId: null })).toBe("idx2");
    expect(wooLineKey({ index: 2, wooLineItemId: 77, addonKey: "casters" })).toBe("77:addon:casters");
  });

  it("resolves Lido ($100) + Cantilever ($150) umbrella covers in one mixed cart without collision", () => {
    const { specs, issues } = extractWooLineSpecs(
      wooOrder({
        line_items: [
          wooLine({
            id: 501,
            sku: "FIN-MLN-UMB",
            meta_data: [
              { key: "umbrella_cover", value: "Yes (+$100.00)" },
              { key: "pa_powder", display_key: "Select Powder Coat", value: "Black" },
            ],
          }),
          wooLine({
            id: 502,
            sku: "FIN-CAN-UMB",
            meta_data: [
              { key: "umbrella_cover", value: "Yes (+$150.00)" },
              { key: "pa_powder", display_key: "Select Powder Coat", value: "Black" },
            ],
          }),
        ],
      }),
    );
    expect(issues).toEqual([]);
    expect(specs).toHaveLength(2);
    expect(specs[0]!.sku).toBe("FIN-MLN-UMB");
    expect(specs[1]!.sku).toBe("FIN-CAN-UMB");
    // Both covers map to the same Hub add-on SKU; parent ACF Meta prices stay
    // distinct on FIN-MLN-UMB ($100) vs FIN-CAN-UMB ($150) — no line collision.
    expect(specs[0]!.addons).toEqual([
      { key: "umbrella_cover", rawValue: "Yes", sku: "FIN-ESY-MIS-WEATHERPROOFCO" },
    ]);
    expect(specs[1]!.addons).toEqual([
      { key: "umbrella_cover", rawValue: "Yes", sku: "FIN-ESY-MIS-WEATHERPROOFCO" },
    ]);
    expect(wooLineKey(specs[0]!)).toBe("501");
    expect(wooLineKey(specs[1]!)).toBe("502");
    expect(wooLineKey({ ...specs[0]!, addonKey: "umbrella_cover" })).toBe(
      "501:addon:umbrella_cover",
    );
    expect(wooLineKey({ ...specs[1]!, addonKey: "umbrella_cover" })).toBe(
      "502:addon:umbrella_cover",
    );
  });
});

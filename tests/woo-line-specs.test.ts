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
      },
    ]);
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

  it("a rejected near-miss key names the accepted keys in its message", () => {
    const { issues } = extractWooLineSpecs(
      wooOrder({ line_items: [wooLine({ meta_data: [{ key: "cushion_fabric", value: "FAB-A" }] })] }),
    );
    expect(issues[0]!.message).toContain("fabric, powder_coat, frame");
    expect(issues[0]!.message).toContain("Use: fabric");
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
  });
});

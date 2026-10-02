import { describe, expect, it } from "vitest";
import {
  canDeleteProductSku,
  classifyKatanaSku,
  classifySalesOrder,
  isProtectedSku,
  isSandboxCustomerName,
} from "@/lib/katana-targeted-purge";

describe("katana-targeted-purge classifiers", () => {
  it("protects legacy namespaces", () => {
    expect(classifyKatanaSku("BRA-C-34X84-LS-BO")).toBe("protected");
    expect(classifyKatanaSku("OCE-SOF-72")).toBe("protected");
    expect(classifyKatanaSku("OCN-SOF-FRAME")).toBe("protected");
    expect(classifyKatanaSku("BRO-AL-60-BE")).toBe("protected");
    expect(classifyKatanaSku("DBT-84")).toBe("protected");
    expect(isProtectedSku("BRA-AL-60-WH")).toBe(true);
  });

  it("classifies hub RM / QA / sandbox / D-*", () => {
    expect(classifyKatanaSku("RM-MET-2X2-TUBING")).toBe("hub_rm");
    expect(classifyKatanaSku("QA-TEST-4733A7A7")).toBe("qa");
    expect(classifyKatanaSku("SANDBOX-MTO")).toBe("sandbox");
    expect(classifyKatanaSku("D-SLAB-01")).toBe("d_dekton");
    expect(classifyKatanaSku("FIN-WFT-DIN-TAB-72X28")).toBe("other");
  });

  it("blocks product delete when referenced by protected BOM", () => {
    expect(
      canDeleteProductSku({
        sku: "RM-PWD-GENERIC",
        referencedByProtectedParent: true,
      }),
    ).toBe(false);
    expect(
      canDeleteProductSku({
        sku: "RM-PWD-GENERIC",
        referencedByProtectedParent: false,
      }),
    ).toBe(true);
    expect(
      canDeleteProductSku({
        sku: "D-SLAB-01",
        referencedByProtectedParent: true,
      }),
    ).toBe(false);
    expect(
      canDeleteProductSku({
        sku: "BRA-AL-60-BE",
        referencedByProtectedParent: false,
      }),
    ).toBe(false);
  });

  it("classifies sandbox sales orders without touching protected lines", () => {
    expect(isSandboxCustomerName("Sandbox MTO Tester")).toBe(true);
    expect(
      classifySalesOrder({
        customerName: "Sandbox MTO Tester",
        orderNo: "SO-1",
        lineSkus: ["RM-PWD-GENERIC"],
        targetSkus: new Set(),
      }),
    ).toBe("sandbox");
    expect(
      classifySalesOrder({
        customerName: "Real Customer",
        orderNo: "SO-2",
        lineSkus: ["BRA-AL-60-BE", "RM-PWD-GENERIC"],
        targetSkus: new Set(["RM-PWD-GENERIC"]),
      }),
    ).toBe("protected");
    expect(
      classifySalesOrder({
        customerName: "Real Customer",
        orderNo: "SO-3",
        lineSkus: ["RM-MET-2X2-TUBING"],
        targetSkus: new Set(["RM-MET-2X2-TUBING"]),
      }),
    ).toBe("blocks_target_sku");
  });
});

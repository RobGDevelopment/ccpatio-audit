import { describe, expect, it } from "vitest";
import { GLOBAL_E2E_SKU_SET } from "@/generated/global-e2e-skus";
import { isGlobalE2eSku } from "@/server/woocommerce/ingress.schema";

describe("GLOBAL_E2E_SKU_SET", () => {
  it("contains the dictionary baselines", () => {
    expect(isGlobalE2eSku("FAB-ACT-ASH")).toBe(true);
    expect(isGlobalE2eSku("STN-DKT-AT2.0")).toBe(true);
    expect(isGlobalE2eSku("SHD-SCO-3MSQ-AST-ECR-TIT")).toBe(true);
    expect(GLOBAL_E2E_SKU_SET.size).toBe(911);
  });

  it("rejects unmapped factory names", () => {
    expect(isGlobalE2eSku("ACTION ASH")).toBe(false);
    expect(isGlobalE2eSku("")).toBe(false);
  });
});

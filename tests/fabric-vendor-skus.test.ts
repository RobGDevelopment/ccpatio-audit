import { describe, expect, it } from "vitest";
import {
  planFabricVendorSkus,
  readFabricNeedRows,
} from "../scripts/ops/lib/fabric-vendor-skus";

describe("fabric vendor SKUs", () => {
  const plan = planFabricVendorSkus(readFabricNeedRows());

  it("keeps one manufacturer code for a repeated fabric name", () => {
    const navy = plan.assignments.find((row) => row.fabric.toLowerCase() === "canvas navy");
    expect(navy).toMatchObject({ vendorSku: "5439-0000" });
    expect(navy && navy.rowCount).toBeGreaterThan(1);
  });

  it("does not pick a style number when the sheet disagrees", () => {
    for (const conflict of plan.conflicts) {
      expect(conflict.vendorSkus.length).toBeGreaterThan(1);
      expect(plan.assignments.some((row) => row.fabric.toLowerCase() === conflict.fabric.toLowerCase())).toBe(
        false,
      );
    }
  });
});

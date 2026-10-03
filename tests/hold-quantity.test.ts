import { describe, expect, it } from "vitest";
import {
  displayStockUom,
  holdQuantityIssue,
  holdQuantityMath,
  holdQuantityWarning,
} from "@/lib/hold-quantity";

describe("displayStockUom", () => {
  it("labels fabric in yards and frames in each", () => {
    expect(displayStockUom("FAB-CRU-ASH")).toBe("yd");
    expect(displayStockUom("SA-BRA-FRAME")).toBe("ea");
  });

  it("reads Katana pcs as ea", () => {
    expect(displayStockUom("SA-BRA-FRAME", "pcs")).toBe("ea");
    expect(displayStockUom("FAB-CRU-ASH", "yd")).toBe("yd");
  });
});

describe("hold quantity guard", () => {
  it("rejects a blank quantity and anything under 1", () => {
    expect(holdQuantityIssue("")).toBeTruthy();
    expect(holdQuantityWarning("")).toBeNull();
    expect(holdQuantityIssue("0")).toMatch(/at least 1/);
    expect(holdQuantityWarning("0.5")).toMatch(/at least 1/);
    expect(holdQuantityIssue("21")).toBeNull();
    expect(holdQuantityIssue("1.5")).toBeNull();
  });

  it("subtracts the hold from current available", () => {
    expect(holdQuantityMath("5", 20)).toEqual({ quantity: 5, available: 20, ending: 15 });
    expect(holdQuantityMath("1.25", 2.5)).toEqual({ quantity: 1.25, available: 2.5, ending: 1.25 });
    expect(holdQuantityMath("1", 0)).toEqual({ quantity: 1, available: 0, ending: -1 });
  });
});

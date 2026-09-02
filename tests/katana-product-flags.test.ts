import { describe, expect, it } from "vitest";
import { katanaProductSyncFlags } from "@/lib/katana-product-flags";

describe("katanaProductSyncFlags", () => {
  it("keeps finished goods sellable and producible", () => {
    expect(katanaProductSyncFlags("finished_good")).toEqual({
      is_sellable: true,
      is_producible: true,
      is_purchasable: false,
    });
  });

  it("marks sub-assemblies producible but not sellable", () => {
    expect(katanaProductSyncFlags("sub_assembly")).toEqual({
      is_sellable: false,
      is_producible: true,
      is_purchasable: false,
    });
  });

  it("treats services as sellable non-producible", () => {
    expect(katanaProductSyncFlags("service")).toEqual({
      is_sellable: true,
      is_producible: false,
      is_purchasable: false,
    });
  });
});

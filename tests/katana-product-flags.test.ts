import { describe, expect, it } from "vitest";
import {
  katanaIsSellableProduct,
  katanaProductSyncFlags,
} from "@/lib/katana-product-flags";

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

  it("sells only FIN-* finished goods (and services)", () => {
    expect(katanaIsSellableProduct("finished_good", "FIN-BRV-SOF-72X34")).toBe(
      true,
    );
    expect(katanaIsSellableProduct("finished_good", "SA-BRV-SOF-72X34-FRAME")).toBe(
      false,
    );
    expect(katanaIsSellableProduct("sub_assembly", "SA-BRV-SOF-72X34-FRAME")).toBe(
      false,
    );
    expect(katanaIsSellableProduct("raw_material", "FAB-ACT-ASH")).toBe(false);
    expect(katanaIsSellableProduct("service", "SVC-DELIVER")).toBe(true);
  });
});

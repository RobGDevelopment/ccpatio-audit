import { describe, expect, it } from "vitest";
import { KATANA_GENERIC_FABRIC_VARIANT_ID } from "@/lib/katana-bulk-materials";
import {
  collectChildMoIdsFromRecipeRows,
  collectNestedManufacturingOrderIds,
  findRecipeRowsByVariantId,
  isMoInParentTree,
  isNestedMoOrderNo,
  parseKatanaListPayload,
  parseMoRecipeRow,
  resolveCreateSubassemblies,
} from "@/lib/katana-mto";
import {
  SANDBOX_MTO_SPECIFIC_FABRIC_SKU,
  SANDBOX_MTO_SPECIFIC_FABRIC_VARIANT_ID,
} from "@/lib/katana-mto-sandbox";

describe("MTO subassembly flag", () => {
  it("defaults to false so live callers stay flat", () => {
    expect(resolveCreateSubassemblies()).toBe(false);
    expect(resolveCreateSubassemblies({})).toBe(false);
    expect(resolveCreateSubassemblies({ createSubassemblies: false })).toBe(false);
  });

  it("enables child MOs only when explicitly true", () => {
    expect(resolveCreateSubassemblies({ createSubassemblies: true })).toBe(true);
  });
});

describe("MO recipe-row parsing", () => {
  it("reads wrapped and unwrapped Katana list payloads", () => {
    expect(
      parseKatanaListPayload({
        data: [{ id: 9, manufacturing_order_id: 1, variant_id: 2 }],
      }),
    ).toHaveLength(1);
    expect(
      parseKatanaListPayload([{ id: 9, manufacturing_order_id: 1, variant_id: 2 }]),
    ).toHaveLength(1);
  });

  it("finds the generic fabric row and ignores other ingredients", () => {
    const rows = [
      parseMoRecipeRow({
        id: 11,
        manufacturing_order_id: 100,
        variant_id: 23178511,
      }),
      parseMoRecipeRow({
        id: 12,
        manufacturing_order_id: 100,
        variant_id: KATANA_GENERIC_FABRIC_VARIANT_ID,
      }),
    ].filter((row) => row !== null);

    const matches = findRecipeRowsByVariantId(rows, KATANA_GENERIC_FABRIC_VARIANT_ID);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe(12);
  });

  it("collects child MO ids from recipe rows when Katana exposes them", () => {
    const rows = [
      parseMoRecipeRow({
        id: 1,
        manufacturing_order_id: 10,
        variant_id: 20,
        related_manufacturing_order_id: 99,
      }),
    ].filter((row) => row !== null);
    expect(collectChildMoIdsFromRecipeRows(rows)).toEqual([99]);
  });
});

describe("nested MO discovery", () => {
  it("treats create_subassemblies order numbers as children of the parent", () => {
    expect(isNestedMoOrderNo("SO-2 / 1", "SO-2 / 1 / 1")).toBe(true);
    expect(isNestedMoOrderNo("SO-2 / 1", "SO-2 / 1")).toBe(false);
    expect(isNestedMoOrderNo("SO-2 / 1", "SO-9 / 1")).toBe(false);
  });

  it("only trusts MOs on the same sales-order row or nested order_no", () => {
    const parent = {
      id: 1,
      sales_order_id: 50,
      sales_order_row_id: 7,
      order_no: "SANDBOX-MTO-1 / 1",
    };
    expect(
      isMoInParentTree(
        {
          id: 2,
          sales_order_id: 50,
          sales_order_row_id: 7,
          order_no: "SANDBOX-MTO-1 / 1 / 1",
        },
        parent,
      ),
    ).toBe(true);
    expect(
      isMoInParentTree(
        {
          id: 9,
          sales_order_id: 50,
          sales_order_row_id: 99,
          order_no: "OTHER / 1",
        },
        parent,
      ),
    ).toBe(false);
    expect(
      isMoInParentTree(
        {
          id: 3,
          sales_order_id: null,
          sales_order_row_id: null,
          order_no: "SANDBOX-MTO-1 / 1 / 2",
        },
        parent,
      ),
    ).toBe(true);
  });

  it("collects nested MO ids from MTO payloads without treating location ids as MOs", () => {
    const ids = collectNestedManufacturingOrderIds({
      id: 10,
      order_no: "SO-1 / 1",
      location_id: 2327,
      manufacturing_orders: [
        { id: 11, order_no: "SO-1 / 1 / 1", variant_id: 5 },
      ],
    });
    expect(ids).toContain(11);
    expect(ids).not.toContain(2327);
  });
});

describe("sandbox fabric target", () => {
  it("hardcodes a FAB-* SKU and numeric variant-id slot", () => {
    expect(SANDBOX_MTO_SPECIFIC_FABRIC_SKU.startsWith("FAB-")).toBe(true);
    expect(typeof SANDBOX_MTO_SPECIFIC_FABRIC_VARIANT_ID).toBe("number");
  });

  it("uses the live-pull RM-FAB-GENERIC variant as the generic swap source", () => {
    expect(KATANA_GENERIC_FABRIC_VARIANT_ID).toBe(23178514);
  });
});

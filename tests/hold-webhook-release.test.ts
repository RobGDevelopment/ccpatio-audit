import { describe, expect, it } from "vitest";
import { KATANA_HOLD_SALES_ORDER, KATANA_HOLD_STOCK_ADJUSTMENT } from "@/lib/katana";
import { readHoldDeletion } from "@/server/katana/variant-webhook";
import { decideDeletedHoldRelease } from "@/server/stock/release-hold";

const base = {
  status: "active",
  orderNo: "HOLD-8f2a1c3d",
  documentId: 88,
  storedKind: KATANA_HOLD_STOCK_ADJUSTMENT,
  eventKind: KATANA_HOLD_STOCK_ADJUSTMENT,
  eventNumber: "HOLD-8f2a1c3d",
  eventId: 88,
} as const;

describe("readHoldDeletion", () => {
  it("reads a stock adjustment id when the number is missing", () => {
    expect(readHoldDeletion({ action: "stock_adjustment.deleted", object: { id: 9 } })).toEqual({
      kind: "deleted",
      documentKind: "stock_adjustment",
      number: null,
      documentId: 9,
    });
  });

  it("reads a deleted HOLD- sales order", () => {
    expect(
      readHoldDeletion({
        action: "sales_order.deleted",
        object: { id: 44, order_no: "HOLD-8f2a1c3d" },
      }),
    ).toEqual({
      kind: "deleted",
      documentKind: "sales_order",
      number: "HOLD-8f2a1c3d",
      documentId: 44,
    });
  });
});

describe("decideDeletedHoldRelease", () => {
  it("releases when the HOLD- number matches", () => {
    expect(decideDeletedHoldRelease(base)).toBe("release");
  });

  it("releases when only the document id matches a HOLD- row", () => {
    expect(
      decideDeletedHoldRelease({
        ...base,
        eventNumber: null,
        eventKind: KATANA_HOLD_SALES_ORDER,
        storedKind: KATANA_HOLD_SALES_ORDER,
      }),
    ).toBe("release");
  });

  it("ignores a kind mismatch", () => {
    expect(
      decideDeletedHoldRelease({
        ...base,
        eventKind: KATANA_HOLD_SALES_ORDER,
        storedKind: KATANA_HOLD_STOCK_ADJUSTMENT,
      }),
    ).toBe("ignore");
  });

  it("notes a converting row instead of releasing it", () => {
    expect(decideDeletedHoldRelease({ ...base, status: "converting" })).toBe("note");
  });
});

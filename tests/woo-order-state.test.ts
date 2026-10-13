import { describe, expect, it } from "vitest";
import { classifyWooOrder, isWooOrderPaid } from "@/server/woocommerce/order-state";

const PAID_AT = "2026-10-13T12:00:00";

describe("isWooOrderPaid", () => {
  it.each([
    [{ status: "processing" }, true],
    [{ status: "completed" }, true],
    [{ status: "Processing" }, true],
    [{ status: "pending", date_paid: PAID_AT }, true],
    [{ status: "on-hold", date_paid: PAID_AT }, true],
    [{ status: "pending" }, false],
    [{ status: "on-hold" }, false],
    [{ status: "failed" }, false],
    [{ status: "checkout-draft" }, false],
    [{ status: "cancelled" }, false],
    [{ status: "refunded" }, false],
    [{ status: "pending", date_paid: null }, false],
    [{ status: "pending", date_paid: "" }, false],
    [{ status: "pending", date_paid: "  " }, false],
    [{ status: undefined }, false],
    [{}, false],
    [{ status: 5 }, false],
  ])("%j -> paid=%s", (order, expected) => {
    expect(isWooOrderPaid(order)).toBe(expected);
  });
});

describe("classifyWooOrder", () => {
  it.each([
    [{ status: "processing" }, "paid"],
    [{ status: "completed" }, "paid"],
    [{ status: "processing", date_paid: PAID_AT }, "paid"],
    [{ status: "pending", date_paid: PAID_AT }, "paid"],
    [{ status: "pending" }, "awaiting_payment"],
    [{ status: "on-hold" }, "awaiting_payment"],
    [{ status: "checkout-draft" }, "awaiting_payment"],
    [{ status: "some-new-woo-status" }, "awaiting_payment"],
    [{}, "awaiting_payment"],
    [{ status: "cancelled" }, "terminal_unpaid"],
    [{ status: "failed" }, "terminal_unpaid"],
    [{ status: "refunded" }, "terminal_unpaid"],
    [{ status: "cancelled", date_paid: null }, "terminal_unpaid"],
    [{ status: "cancelled", date_paid: PAID_AT }, "terminal_after_paid_needs_human"],
    [{ status: "refunded", date_paid: PAID_AT }, "terminal_after_paid_needs_human"],
    [{ status: "failed", date_paid: PAID_AT }, "terminal_after_paid_needs_human"],
  ])("%j -> %s", (order, expected) => {
    expect(classifyWooOrder(order)).toBe(expected);
  });

  it("a cancelled order never classifies as paid, so it can never reach Katana", () => {
    for (const status of ["cancelled", "refunded", "failed"]) {
      for (const date_paid of [undefined, null, "", PAID_AT]) {
        expect(classifyWooOrder({ status, date_paid })).not.toBe("paid");
        expect(classifyWooOrder({ status, date_paid })).not.toBe("awaiting_payment");
      }
    }
  });
});

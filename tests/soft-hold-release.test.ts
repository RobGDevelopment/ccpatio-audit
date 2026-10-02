import { describe, expect, it } from "vitest";
import { FABRIC_HOLD_ORDER_ID } from "@/server/ghl/hold-order";
import { holdDeleteBlocker } from "@/server/stock/delete-hold-order";

const openHold = {
  id: 88,
  order_no: "HOLD-8f2a1c3d",
  status: "NOT_SHIPPED",
  invoicing_status: "notInvoiced",
  sales_order_rows: [{ variant_id: 1, quantity: 2 }],
};

describe("holdDeleteBlocker", () => {
  it("allows the ledger's own unshipped HOLD- order", () => {
    expect(holdDeleteBlocker(openHold, 88, "HOLD-8f2a1c3d")).toBeNull();
  });

  it("refuses the legacy fabric freeze and any order that is not HOLD-", () => {
    expect(
      holdDeleteBlocker(
        { ...openHold, id: FABRIC_HOLD_ORDER_ID, order_no: "MIG-HOLD-FABRIC-20260811" },
        FABRIC_HOLD_ORDER_ID,
        "HOLD-8f2a1c3d",
      ),
    ).toMatch(/legacy fabric freeze/);
    expect(
      holdDeleteBlocker({ ...openHold, order_no: "GHL-opp" }, 88, "HOLD-8f2a1c3d"),
    ).toMatch(/Refusing to delete/);
  });

  it("refuses a delivered line or a manufacturing order", () => {
    expect(
      holdDeleteBlocker(
        {
          ...openHold,
          sales_order_rows: [{ quantity_delivered: 1 }],
        },
        88,
        "HOLD-8f2a1c3d",
      ),
    ).toMatch(/delivered/);
    expect(
      holdDeleteBlocker(
        {
          ...openHold,
          sales_order_rows: [{ linked_manufacturing_order_id: 44 }],
        },
        88,
        "HOLD-8f2a1c3d",
      ),
    ).toMatch(/manufacturing order/);
  });
});

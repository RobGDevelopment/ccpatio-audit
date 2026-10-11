import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const deleteDoc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/katana", () => {
  class KatanaApiError extends Error {
    readonly status: number;
    constructor(message: string, options: { status: number }) {
      super(message);
      this.name = "KatanaApiError";
      this.status = options.status;
    }
  }
  return {
    KATANA_HOLD_STOCK_ADJUSTMENT: "stock_adjustment",
    KATANA_HOLD_SALES_ORDER: "sales_order",
    KatanaApiError,
    deleteKatanaHoldDocument: (...args: unknown[]) => deleteDoc(...args),
    katanaFetch: vi.fn(async (path: string) => {
      calls.push(`GET ${path}`);
      throw new KatanaApiError("sales order must not be read for a material hold", { status: 404 });
    }),
  };
});

import { KATANA_HOLD_STOCK_ADJUSTMENT, KatanaApiError } from "@/lib/katana";
import {
  deleteHoldByRecordedKind,
  holdDeleteRoute,
} from "@/server/stock/delete-hold-order";

describe("hold delete route", () => {
  beforeEach(() => {
    calls.length = 0;
    deleteDoc.mockReset();
    deleteDoc.mockImplementation(async (_kind: string, id: number) => {
      calls.push(`DELETE /stock_adjustments/${id}`);
    });
  });

  it("keeps a sales order and a missing flag on the sales-order path", () => {
    expect(holdDeleteRoute("sales_order")).toBe("sales_order");
    expect(holdDeleteRoute(null)).toBe("sales_order");
    expect(holdDeleteRoute(KATANA_HOLD_STOCK_ADJUSTMENT)).toBe("stock_adjustment");
  });

  it("does not call sales orders when the recorded kind is a stock adjustment", async () => {
    const outcome = await deleteHoldByRecordedKind(
      KATANA_HOLD_STOCK_ADJUSTMENT,
      88,
      "HOLD-8f2a1c3d",
    );
    expect(outcome).toBe("deleted");
    expect(calls.some((call) => call.includes("/sales_orders/"))).toBe(false);
    expect(calls).toContain("DELETE /stock_adjustments/88");
    expect(deleteDoc).toHaveBeenCalledWith(KATANA_HOLD_STOCK_ADJUSTMENT, 88);
  });

  it("treats a 404 from the stock adjustment as already gone", async () => {
    deleteDoc.mockRejectedValue(new KatanaApiError("missing adjustment", { status: 404 }));
    await expect(
      deleteHoldByRecordedKind(KATANA_HOLD_STOCK_ADJUSTMENT, 88, "HOLD-8f2a1c3d"),
    ).resolves.toBe("absent");
    expect(calls.some((call) => call.includes("/sales_orders/"))).toBe(false);
  });

  it("does not treat a non-404 adjustment failure as gone", async () => {
    deleteDoc.mockRejectedValue(new KatanaApiError("katana down", { status: 500 }));
    await expect(
      deleteHoldByRecordedKind(KATANA_HOLD_STOCK_ADJUSTMENT, 88, "HOLD-8f2a1c3d"),
    ).rejects.toBeInstanceOf(KatanaApiError);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const inserts = vi.hoisted(() => [] as Record<string, unknown>[]);
const insertError = vi.hoisted(() => ({ current: null as Error | null }));

vi.mock("@/server/db/client", () => ({
  getDb: () => ({
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        if (insertError.current) throw insertError.current;
        inserts.push(row);
      },
    }),
  }),
}));

import { closeFailedHoldWrite } from "@/server/stock/create-hold";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  katana_variant_id: 9,
  sku: "FAB-1",
  qty: "1.0000",
  ghl_user_id: "rep",
  ghl_user_name: "Rep",
  ghl_user_email: null,
  ghl_contact_id: "contact",
  ghl_opportunity_id: "opp",
  ghl_opportunity_name: "Opportunity",
  note: "Client deciding",
  expires_at: new Date("2026-10-25T00:00:00.000Z"),
  katana_dummy_so_id: 88,
  katana_sales_order_row_id: null,
  order_no: "HOLD-8f2a1c3d",
  converted_order_no: "stock_adjustment" as const,
};

describe("closeFailedHoldWrite", () => {
  beforeEach(() => {
    inserts.length = 0;
    insertError.current = null;
  });

  it("inserts nothing when the compensating delete succeeded", async () => {
    const result = await closeFailedHoldWrite({
      deleteError: null,
      shown: "Could not save the hold.",
      row,
    });
    expect(result).toEqual({ ok: false, error: "Could not save the hold." });
    expect(inserts).toHaveLength(0);
  });

  it("inserts one releasing row when the compensating delete failed", async () => {
    const result = await closeFailedHoldWrite({
      deleteError: "Katana refused",
      shown: "Could not save the hold. Compensating delete failed: Katana refused",
      row,
    });
    expect(result.ok).toBe(false);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      id: row.id,
      status: "releasing",
      release_reason: "manual",
      released_by: "compensate",
      order_no: "HOLD-8f2a1c3d",
      katana_dummy_so_id: 88,
    });
    expect(String(inserts[0]?.last_error)).toContain("Katana refused");
  });

  it("returns the insert failure instead of swallowing it", async () => {
    insertError.current = new Error("database down");
    const result = await closeFailedHoldWrite({
      deleteError: "Katana refused",
      shown: "Could not save the hold.",
      row,
    });
    expect(result).toEqual({
      ok: false,
      error: "Could not save the hold. database down",
    });
    expect(inserts).toHaveLength(0);
  });
});

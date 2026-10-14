/**
 * Phase 11 Task 8 — GHL opportunity write-back (QCA remediation: B5, m3).
 *
 * The previous suite fed a non-existent `status` column through an undifferentiated mock, so the
 * production bug (reading `item.status` instead of `design_status`) could never fail. Fixtures here
 * are typed to `typeof custom_build_job_items.$inferSelect`, and the fake DB answers per table, so
 * finalized BOM lines and the item status must really be loaded for the assertions to pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadOpportunitySummaryData,
  syncOpportunitySummaryToGhl,
  type GhlWritebackDeps,
} from "@/server/ghl/opportunity-writeback";
import type { custom_build_job_items } from "@/server/db/schema";
import { createFakeDb, type FakeTables } from "./helpers/path-a-fake-db";

type ItemRow = typeof custom_build_job_items.$inferSelect;

const OPP = "opp-123";
const SAVED_ENV = { ...process.env };

function item(over: Partial<ItemRow> & Pick<ItemRow, "global_sku">): ItemRow {
  return {
    id: `item-${over.global_sku}`,
    job_id: "job-1",
    quantity: 1,
    design_status: "finalized",
    cad_upload_id: null,
    finalized_dossier_hash: "dossier-12345abcdef",
    finalized_at: null,
    finalized_by: null,
    katana_sales_order_row_id: null,
    katana_mo_id: null,
    released_at: null,
    created_at: new Date("2026-10-01T00:00:00Z"),
    updated_at: new Date("2026-10-01T00:00:00Z"),
    ...over,
  };
}

function tablesFor(items: ItemRow[], syncHash: string | null = null): FakeTables {
  return {
    custom_build_jobs: [
      {
        id: "job-1",
        ghl_opportunity_id: OPP,
        display_name: "Custom Pergola",
        katana_order_no: "PA-opp-123",
        katana_mo_ids: [801],
        ghl_sync_hash: syncHash,
      },
    ],
    saga_runs: [
      { saga_type: "path_a_cad", correlation_key: OPP, status: "AWAITING_DEPOSIT" },
    ],
    custom_build_job_items: items as unknown as FakeTables[string],
    product_bom: [
      { parent_sku: "JOB-PERGOLA-1", child_sku: "RM-TUBE-ALUM-4X4", quantity: "8.5000", unit_of_measure: "ft" },
      { parent_sku: "JOB-PERGOLA-1", child_sku: "RM-CAP-PLASTIC-4X4", quantity: "1.0000", unit_of_measure: "ea" },
      { parent_sku: "JOB-OTHER", child_sku: "RM-SHOULD-NOT-APPEAR", quantity: "1.0000", unit_of_measure: "ea" },
    ],
  };
}

describe("B5: write-back reads design_status and loads finalized BOM lines", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
  });
  afterEach(() => {
    process.env = { ...SAVED_ENV };
  });

  it("returns the item's real design_status (not undefined) and its BOM lines for a finalized item", async () => {
    const { db } = createFakeDb(tablesFor([item({ global_sku: "JOB-PERGOLA-1" })]));
    const data = await loadOpportunitySummaryData(OPP, db as never);

    expect(data).not.toBeNull();
    const [only] = data!.input.items;
    expect(only.status).toBe("finalized");
    expect(only.bomLines?.map((l) => l.childSku).sort()).toEqual([
      "RM-CAP-PLASTIC-4X4",
      "RM-TUBE-ALUM-4X4",
    ]);
  });

  it("loads BOM lines for a released item and the summary text carries SKU, status and BOM", async () => {
    const { db } = createFakeDb(
      tablesFor([item({ global_sku: "JOB-PERGOLA-1", design_status: "released" })]),
    );
    const putGhl = vi.fn(async (_p: string, _b: unknown) => ({ ok: true as const, locationId: "l", body: {} }));
    const res = await syncOpportunitySummaryToGhl(OPP, {
      db: db as never,
      getSyncMode: () => "live",
      getFieldId: () => "field-1",
      putGhl: putGhl as unknown as GhlWritebackDeps["putGhl"],
    });
    expect(res.ok).toBe(true);
    const body = putGhl.mock.calls[0][1] as { customFields: Array<{ field_value: string }> };
    const text = body.customFields[0].field_value;
    expect(text).toContain("JOB-PERGOLA-1 x1");
    expect(text).toContain("RELEASED");
    expect(text).toContain("RM-TUBE-ALUM-4X4: 8.5000 ft");
    expect(text).toContain("RM-CAP-PLASTIC-4X4: 1.0000 ea");
    expect(text).not.toContain("RM-SHOULD-NOT-APPEAR");
    expect(text).not.toContain("UNDEFINED");
  });

  it("does NOT load BOM lines for an item that is still designing, but still reports its status", async () => {
    const { db } = createFakeDb(
      tablesFor([item({ global_sku: "JOB-PERGOLA-1", design_status: "needs_review" })]),
    );
    const data = await loadOpportunitySummaryData(OPP, db as never);
    const [only] = data!.input.items;
    expect(only.status).toBe("needs_review");
    expect(only.bomLines).toEqual([]);
  });

  it("multi-SKU: every item is listed with its own status and its own BOM", async () => {
    const tables = tablesFor([
      item({ global_sku: "JOB-PERGOLA-1" }),
      item({ global_sku: "JOB-OTHER", design_status: "released" }),
    ]);
    const { db } = createFakeDb(tables);
    const data = await loadOpportunitySummaryData(OPP, db as never);
    const bySku = Object.fromEntries(data!.input.items.map((i) => [i.globalSku, i]));
    expect(bySku["JOB-PERGOLA-1"].status).toBe("finalized");
    expect(bySku["JOB-OTHER"].status).toBe("released");
    expect(bySku["JOB-OTHER"].bomLines?.map((l) => l.childSku)).toEqual(["RM-SHOULD-NOT-APPEAR"]);
  });

  it("returns null when no job exists for the opportunity", async () => {
    const { db } = createFakeDb({ ...tablesFor([]), custom_build_jobs: [] });
    expect(await loadOpportunitySummaryData(OPP, db as never)).toBeNull();
  });
});

describe("m3: no hard-coded host fallback in the write-back", () => {
  afterEach(() => {
    process.env = { ...SAVED_ENV };
  });

  it("uses NEXT_PUBLIC_APP_URL for the dashboard deep link", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.test";
    const { db } = createFakeDb(tablesFor([item({ global_sku: "JOB-PERGOLA-1" })]));
    const data = await loadOpportunitySummaryData(OPP, db as never);
    expect(data!.input.appUrl).toBe("https://staging.example.test");
  });

  it("never injects app.ccpatio.com when the host is not configured", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { db } = createFakeDb(tablesFor([item({ global_sku: "JOB-PERGOLA-1" })]));
    const putGhl = vi.fn(async (_p: string, _b: unknown) => ({ ok: true as const, locationId: "l", body: {} }));
    await syncOpportunitySummaryToGhl(OPP, {
      db: db as never,
      getSyncMode: () => "live",
      getFieldId: () => "field-1",
      putGhl: putGhl as unknown as GhlWritebackDeps["putGhl"],
    });
    const body = putGhl.mock.calls[0][1] as { customFields: Array<{ field_value: string }> };
    expect(body.customFields[0].field_value).not.toContain("app.ccpatio.com");
  });
});

describe("Path A GHL Sync (Task 8) — transport behaviour", () => {
  let ghlCalls: Array<{ method: string; path: string; body?: unknown }>;

  beforeEach(() => {
    ghlCalls = [];
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
  });
  afterEach(() => {
    process.env = { ...SAVED_ENV };
  });

  const getGhl = vi.fn(async (path: string) => {
    ghlCalls.push({ method: "GET", path });
    return {
      ok: true as const,
      locationId: "loc-1",
      body: { opportunity: { id: OPP, contactId: "contact-456" } },
    };
  });
  const putGhl = vi.fn(async (path: string, body: unknown) => {
    ghlCalls.push({ method: "PUT", path, body });
    return { ok: true as const, locationId: "loc-1", body: {} };
  });
  const postGhl = vi.fn(async (path: string, body: unknown) => {
    ghlCalls.push({ method: "POST", path, body });
    return { ok: true as const, locationId: "loc-1", body: {} };
  });
  const base = (db: unknown, extra: Partial<GhlWritebackDeps> = {}): GhlWritebackDeps => ({
    db: db as never,
    getGhl: getGhl as unknown as GhlWritebackDeps["getGhl"],
    putGhl: putGhl as unknown as GhlWritebackDeps["putGhl"],
    postGhl: postGhl as unknown as GhlWritebackDeps["postGhl"],
    ...extra,
  });

  it("skips GHL in dry-run mode and persists nothing", async () => {
    const { db, updates } = createFakeDb(tablesFor([item({ global_sku: "JOB-PERGOLA-1" })]));
    const res = await syncOpportunitySummaryToGhl(OPP, base(db, { getSyncMode: () => "log" }));
    expect(res).toMatchObject({ ok: true, dryRun: true });
    expect(ghlCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("skips when the content hash matches ghl_sync_hash (idempotent)", async () => {
    const first = createFakeDb(tablesFor([item({ global_sku: "JOB-PERGOLA-1" })]));
    const firstRes = await syncOpportunitySummaryToGhl(
      OPP,
      base(first.db, { getSyncMode: () => "live", getFieldId: () => "field-x" }),
    );
    expect(firstRes.ok).toBe(true);
    const hash = (firstRes as { contentHash: string }).contentHash;
    ghlCalls.length = 0;

    const second = createFakeDb(tablesFor([item({ global_sku: "JOB-PERGOLA-1" })], hash));
    const secondRes = await syncOpportunitySummaryToGhl(
      OPP,
      base(second.db, { getSyncMode: () => "live", getFieldId: () => "field-x" }),
    );
    expect(secondRes).toMatchObject({ ok: true, skipped: true, reason: "hash_unchanged" });
    expect(ghlCalls).toHaveLength(0);
  });

  it("syncs via the opportunity custom field when a field id is configured and persists the hash", async () => {
    const { db, updates } = createFakeDb(tablesFor([item({ global_sku: "JOB-PERGOLA-1" })]));
    const res = await syncOpportunitySummaryToGhl(
      OPP,
      base(db, { getSyncMode: () => "live", getFieldId: () => "custom-field-xyz" }),
    );
    expect(res.ok).toBe(true);
    expect(ghlCalls).toHaveLength(1);
    expect(ghlCalls[0].method).toBe("PUT");
    expect(ghlCalls[0].path).toBe("/opportunities/opp-123");
    expect(updates.find((u) => u.table === "custom_build_jobs")?.values.ghl_sync_hash).toBeDefined();
  });

  it("falls back to a contact note when the field id is blank", async () => {
    const { db } = createFakeDb(tablesFor([item({ global_sku: "JOB-PERGOLA-1" })]));
    const res = await syncOpportunitySummaryToGhl(
      OPP,
      base(db, { getSyncMode: () => "live", getFieldId: () => "" }),
    );
    expect(res.ok).toBe(true);
    expect(ghlCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /opportunities/opp-123",
      "POST /contacts/contact-456/notes",
    ]);
    expect((ghlCalls[1].body as { body: string }).body).toContain("=== CC CUSTOM BUILD SUMMARY ===");
  });
});

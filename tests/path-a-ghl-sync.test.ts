import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncOpportunitySummaryToGhl } from "@/server/ghl/opportunity-writeback";

describe("Path A GHL Sync (Task 8)", () => {
  let ghlCalls: Array<{ method: string; path: string; body?: any }>;
  let updatedJobRecord: any;

  beforeEach(() => {
    ghlCalls = [];
    updatedJobRecord = null;
  });

  function createMockDb(syncHash: string | null = null) {
    return {
      select: () => ({
        from: (table: any) => ({
          where: () => ({
            limit: async () => [
              {
                id: "job-1",
                displayName: "Custom Pergola",
                katanaOrderNo: "PA-opp-123",
                katanaMoIds: [801],
                ghlSyncHash: syncHash,
                status: "AWAITING_DEPOSIT",
              },
            ],
            // For items query (without limit)
            then: (resolve: any) =>
              resolve([
                {
                  id: "item-1",
                  job_id: "job-1",
                  global_sku: "JOB-PERGOLA-1",
                  quantity: 1,
                  status: "finalized",
                  finalized_dossier_hash: "dossier-12345",
                },
              ]),
          }),
        }),
      }),
      update: () => ({
        set: (val: any) => {
          updatedJobRecord = val;
          return {
            where: async () => [],
          };
        },
      }),
    };
  }

  const mockGetGhl = vi.fn(async (path: string) => {
    ghlCalls.push({ method: "GET", path });
    return {
      ok: true as const,
      body: {
        opportunity: {
          id: "opp-123",
          contactId: "contact-456",
        },
      },
    };
  });

  const mockPutGhl = vi.fn(async (path: string, body: any) => {
    ghlCalls.push({ method: "PUT", path, body });
    return { ok: true as const, body: {} };
  });

  const mockPostGhl = vi.fn(async (path: string, body: any) => {
    ghlCalls.push({ method: "POST", path, body });
    return { ok: true as const, body: {} };
  });

  it("skips GHL call in dry-run mode and logs structured line", async () => {
    const db = createMockDb();
    const res = await syncOpportunitySummaryToGhl("opp-123", {
      db,
      getSyncMode: () => "log",
      putGhl: mockPutGhl,
      postGhl: mockPostGhl,
    });

    expect(res).toMatchObject({ ok: true, dryRun: true });
    expect(ghlCalls).toHaveLength(0);
    expect(updatedJobRecord).toBeNull();
  });

  it("skips GHL call when content hash matches existing ghl_sync_hash (idempotent)", async () => {
    // First run in live mode to compute hash
    const db1 = createMockDb(null);
    const firstRes = await syncOpportunitySummaryToGhl("opp-123", {
      db: db1,
      getSyncMode: () => "live",
      getFieldId: () => "field-custom-build-summary",
      putGhl: mockPutGhl,
      postGhl: mockPostGhl,
    });

    expect(firstRes.ok).toBe(true);
    const generatedHash = (firstRes as any).contentHash;
    ghlCalls.length = 0;

    // Second run with matching hash
    const db2 = createMockDb(generatedHash);
    const secondRes = await syncOpportunitySummaryToGhl("opp-123", {
      db: db2,
      getSyncMode: () => "live",
      getFieldId: () => "field-custom-build-summary",
      putGhl: mockPutGhl,
      postGhl: mockPostGhl,
    });

    expect(secondRes).toMatchObject({
      ok: true,
      skipped: true,
      reason: "hash_unchanged",
    });
    expect(ghlCalls).toHaveLength(0);
  });

  it("syncs via Opportunity custom field when fieldId is provided", async () => {
    const db = createMockDb(null);
    const res = await syncOpportunitySummaryToGhl("opp-123", {
      db,
      getSyncMode: () => "live",
      getFieldId: () => "custom-field-xyz",
      putGhl: mockPutGhl,
      postGhl: mockPostGhl,
    });

    expect(res.ok).toBe(true);
    expect(ghlCalls).toHaveLength(1);
    expect(ghlCalls[0].method).toBe("PUT");
    expect(ghlCalls[0].path).toBe("/opportunities/opp-123");
    expect(ghlCalls[0].body.customFields[0].id).toBe("custom-field-xyz");
    expect(ghlCalls[0].body.customFields[0].field_value).toContain("=== CC CUSTOM BUILD SUMMARY ===");

    expect(updatedJobRecord).toBeDefined();
    expect(updatedJobRecord.ghl_sync_hash).toBeDefined();
  });

  it("falls back to contact note when fieldId is blank", async () => {
    const db = createMockDb(null);
    const res = await syncOpportunitySummaryToGhl("opp-123", {
      db,
      getSyncMode: () => "live",
      getFieldId: () => "", // blank fieldId -> fallback to note
      getGhl: mockGetGhl,
      putGhl: mockPutGhl,
      postGhl: mockPostGhl,
    });

    expect(res.ok).toBe(true);
    expect(ghlCalls).toHaveLength(2);
    expect(ghlCalls[0].method).toBe("GET");
    expect(ghlCalls[0].path).toBe("/opportunities/opp-123");

    expect(ghlCalls[1].method).toBe("POST");
    expect(ghlCalls[1].path).toBe("/contacts/contact-456/notes");
    expect(ghlCalls[1].body.body).toContain("=== CC CUSTOM BUILD SUMMARY ===");

    expect(updatedJobRecord).toBeDefined();
  });
});

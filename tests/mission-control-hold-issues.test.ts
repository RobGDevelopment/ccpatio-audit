import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  selectFailedRunIssues,
  selectFailedSyncIssues,
  selectHoldLedgerIssues,
  UNKNOWN_ISSUE_COPY,
} from "@/server/mission-control/issue-copy";

describe("mission control hold issues", () => {
  it("strips a bearer ledger error to the fixed sentence", () => {
    const [issue] = selectHoldLedgerIssues([
      {
        id: "hold-1",
        sku: "FAB-1",
        status: "releasing",
        lastError: "Katana refused Bearer sk_live_secret",
        updatedAt: "2026-10-11T03:00:00.000Z",
      },
    ]);
    expect(issue?.title).toBe("Showroom hold did not finish releasing");
    expect(issue?.summary).toBe(UNKNOWN_ISSUE_COPY);
    expect(issue?.runId).toBeNull();
    expect(JSON.stringify(issue)).not.toMatch(/Bearer|sk_live/i);
  });

  it("omits a pending sync row and a released hold", () => {
    const syncs = selectFailedSyncIssues([
      {
        id: "pending-row",
        channel: "katana",
        status: "pending",
        globalSku: "FIN-PENDING",
        updatedAt: "2026-10-11T00:00:00.000Z",
      },
    ]);
    const holds = selectHoldLedgerIssues([
      {
        id: "done",
        sku: "FAB-DONE",
        status: "released",
        lastError: "already gone",
        updatedAt: "2026-10-11T00:00:00.000Z",
      },
    ]);
    expect(syncs).toEqual([]);
    expect(holds).toEqual([]);
  });

  it("names the hold sweeper without changing the publish function id", () => {
    const source = readFileSync("src/services/inngest-api.ts", "utf8");
    const publish = source.slice(
      source.indexOf("export async function fetchFailedPublishJobs"),
      source.indexOf("export async function replayInngestRun"),
    );
    expect(publish).toContain("ccpatio-middleware-publish-approved-product");
    expect(publish).not.toContain("sweep-expired-inventory-holds");

    const [issue] = selectFailedRunIssues([
      {
        run_id: "run_hold",
        function_id: "sweep-expired-inventory-holds",
        started_at: "2026-10-11T04:00:00.000Z",
        error: { message: "database timeout" },
      },
    ]);
    expect(issue?.title).toBe("Hold sweeper failed");
    expect(issue?.spoke).toBe("Katana");
    expect(issue?.summary).toBe(UNKNOWN_ISSUE_COPY);
  });
});

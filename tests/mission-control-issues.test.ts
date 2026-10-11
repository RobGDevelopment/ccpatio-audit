import { describe, expect, it } from "vitest";
import {
  HTTP_401_COPY,
  plainEnglishError,
  selectFailedRunIssues,
  selectFailedSyncIssues,
  UNKNOWN_ISSUE_COPY,
} from "@/server/mission-control/issue-copy";

describe("mission control issue copy", () => {
  it("maps HTTP 401 to the vendor key sentence", () => {
    expect(plainEnglishError("Request failed with status code 401")).toBe(HTTP_401_COPY);
    expect(HTTP_401_COPY).toBe("Access denied. The vendor rejected the key.");
  });

  it("strips a bearer provider payload to the fixed sentence", () => {
    const raw = 'Katana 422 {"error":"invalid","authorization":"Bearer sk_live_secret"}';
    const [issue] = selectFailedRunIssues([
      {
        run_id: "run_1",
        function_id: "ccpatio-middleware-publish-approved-product",
        started_at: "2026-10-11T12:00:00.000Z",
        error: { message: raw },
        event: { data: { globalSku: "FIN-1", token: "Bearer secret", body: raw } },
      },
    ]);

    expect(issue?.summary).toBe(UNKNOWN_ISSUE_COPY);
    expect(issue?.sku).toBe("FIN-1");
    expect(JSON.stringify(issue)).not.toMatch(/Bearer|sk_live|authorization|token/i);
  });

  it("omits a pending sync row", () => {
    const issues = selectFailedSyncIssues([
      {
        id: "pending-row",
        channel: "katana",
        status: "pending",
        globalSku: "FIN-PENDING",
        updatedAt: "2026-10-11T00:00:00.000Z",
        lastError: "Bearer pending-secret",
      },
      {
        id: "failed-row",
        channel: "woocommerce",
        status: "failed",
        globalSku: "FIN-2",
        updatedAt: "2026-10-11T01:00:00.000Z",
        lastError: "upstream status 401",
      },
      {
        id: "custom-row",
        channel: "custom",
        status: "failed",
        globalSku: "FIN-CUSTOM",
        updatedAt: "2026-10-11T02:00:00.000Z",
        lastError: "status 403",
      },
    ]);

    expect(issues.map((issue) => issue.sku)).toEqual(["FIN-2"]);
    expect(issues[0]?.summary).toBe(HTTP_401_COPY);
    expect(JSON.stringify(issues)).not.toMatch(/pending|Bearer|FIN-CUSTOM|lastError/i);
  });

  it("maps 403, 409, and 429 without echoing the provider body", () => {
    expect(plainEnglishError("403 Forbidden")).toBe(
      "Access denied. The vendor refused this account.",
    );
    expect(plainEnglishError("conflict 409")).toBe(
      "This record is already on the spoke. Open the run before retrying.",
    );
    expect(plainEnglishError("429 Too Many Requests")).toBe(
      "The vendor is rate limiting. Wait, then retry.",
    );
    expect(plainEnglishError('{"stripe":"ch_123","status":422}')).toBe(UNKNOWN_ISSUE_COPY);
  });
});

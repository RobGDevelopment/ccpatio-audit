import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getSanitizedQboConfig,
  prefersQboHtmlCallback,
  stripEnvQuotes,
  QBO_OAUTH_RESULT_MESSAGE_TYPE,
} from "@/server/integrations/qbo/oauth";
import {
  renderQboOAuthFailureHtml,
  renderQboOAuthSuccessHtml,
} from "@/server/integrations/qbo/oauth-callback-html";
import {
  HUB_SYNC_FRESH_MS,
  HUB_SYNC_STALE_MS,
  resolveHubSyncBadge,
} from "@/server/stock/hub-sync-freshness";
import {
  classifyWooProbeBody,
  stripHtmlSnippet,
} from "@/server/ecommerce/executive-stack-health";
import { DLQ_STATUS_OPEN, openDlqStatusPredicate } from "@/server/sre/dlq-open";
import { clearQboLiveProbeCache, probeLiveQboToken } from "@/server/integrations/qbo/live-token-probe";

describe("getSanitizedQboConfig — whitespace / CR/LF / quotes", () => {
  it("strips wrapping quotes, spaces, and \\r\\n from QBO env vars", () => {
    const cfg = getSanitizedQboConfig({
      QBO_CLIENT_ID: '  "AbCdEfGhIj"\r\n',
      QBO_CLIENT_SECRET: "\r\n'secret-value'\n",
      QBO_REDIRECT_URI: ' "https://hub.ccpatio.com/api/auth/qbo/callback" ',
      QBO_ENVIRONMENT: " production \n",
    });
    expect(cfg.clientId).toBe("AbCdEfGhIj");
    expect(cfg.clientSecret).toBe("secret-value");
    expect(cfg.redirectUri).toBe("https://hub.ccpatio.com/api/auth/qbo/callback");
    expect(cfg.environment).toBe("production");
    expect(cfg.trimmedWhitespaceOrQuotes).toBe(true);
    expect(cfg.clientIdPrefix).toBe("AbCdEf");
    expect(cfg.clientIdLength).toBe(10);
    expect(cfg.clientSecretLength).toBe("secret-value".length);
  });

  it("falls back to QBO_OAUTH_REDIRECT_URI and canonical origin callback", () => {
    const withAlias = getSanitizedQboConfig({
      QBO_CLIENT_ID: "cid",
      QBO_CLIENT_SECRET: "sec",
      QBO_OAUTH_REDIRECT_URI: "https://hub.ccpatio.com/api/auth/qbo/callback",
    });
    expect(withAlias.redirectUri).toBe(
      "https://hub.ccpatio.com/api/auth/qbo/callback",
    );

    const canonical = getSanitizedQboConfig(
      { QBO_CLIENT_ID: "cid", QBO_CLIENT_SECRET: "sec" },
      "https://hub.ccpatio.com",
    );
    expect(canonical.redirectUri).toBe(
      "https://hub.ccpatio.com/api/auth/qbo/callback",
    );
    expect(stripEnvQuotes('"x"')).toBe("x");
  });
});

describe("QBO dark HTML callback (never raw JSON for browsers)", () => {
  it("prefers HTML for browser Accept / navigate mode", () => {
    expect(
      prefersQboHtmlCallback(
        new Request("https://hub.ccpatio.com/api/auth/qbo/callback", {
          headers: { Accept: "text/html,application/xhtml+xml" },
        }),
      ),
    ).toBe(true);
    expect(
      prefersQboHtmlCallback(
        new Request("https://hub.ccpatio.com/api/auth/qbo/callback", {
          headers: { Accept: "application/json" },
        }),
      ),
    ).toBe(false);
  });

  it("renders dark success + failure pages with diagnostics (no secret dump)", () => {
    const cfg = getSanitizedQboConfig({
      QBO_CLIENT_ID: "ABCDEF123",
      QBO_CLIENT_SECRET: "super-secret-value",
      QBO_REDIRECT_URI: "https://hub.ccpatio.com/api/auth/qbo/callback",
      QBO_ENVIRONMENT: "production",
    });
    const ok = renderQboOAuthSuccessHtml();
    expect(ok).toContain("QuickBooks Online Connected");
    expect(ok).toContain(QBO_OAUTH_RESULT_MESSAGE_TYPE);
    expect(ok).toContain("background:");
    expect(ok.toLowerCase()).not.toContain("super-secret-value");

    const fail = renderQboOAuthFailureHtml({
      oauthError: "invalid_client",
      message: "Intuit rejected the token exchange.",
      config: cfg,
    });
    expect(fail).toContain("invalid_client");
    expect(fail).toContain("clientIdPrefix");
    expect(fail).toContain("ABCDEF");
    expect(fail).toContain("Try Reconnect Again");
    expect(fail).not.toContain("super-secret-value");
    expect(fail).toContain('data-testid="qbo-oauth-diagnostics"');
  });

  it("callback route returns HTML for browser Accept on failure", async () => {
    vi.resetModules();
    const cookieStore = { get: vi.fn().mockReturnValue({ value: "state-1" }) };
    vi.doMock("next/headers", () => ({
      cookies: async () => cookieStore,
    }));
    vi.doMock("@/server/db/client", () => ({
      getDb: () => ({
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      }),
    }));
    vi.doMock("@/server/integrations/qbo/client", () => ({
      getQboTokenId: () => true,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => '{"error":"invalid_client","error_description":"Secret leak"}',
      }),
    );
    process.env.QBO_CLIENT_ID = "cid123";
    process.env.QBO_CLIENT_SECRET = "csecret";
    process.env.QBO_REDIRECT_URI = "https://hub.ccpatio.com/api/auth/qbo/callback";

    const { GET } = await import("@/app/api/auth/qbo/callback/route");
    const res = await GET(
      new Request(
        "https://hub.ccpatio.com/api/auth/qbo/callback?code=x&realmId=r1&state=state-1",
        { headers: { Accept: "text/html" } },
      ),
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type") ?? "").toContain("text/html");
    const html = await res.text();
    expect(html).toContain("invalid_client");
    expect(html).not.toContain("Secret leak");
    expect(html.trimStart().startsWith("{")).toBe(false);
  });
});

describe("stackHealth QBO probe marks Reconnect Required on invalid_client", () => {
  it("wires honest live probe into getExecutiveStackHealthAction (not fake Green)", () => {
    const actions = readFileSync(
      join(process.cwd(), "src/app/embed/admin/master-catalog/actions.ts"),
      "utf8",
    );
    expect(actions).toContain("probeLiveQboToken");
    expect(actions).toContain("qboProbe.status");
    expect(actions).not.toMatch(
      /qboLayer:[\s\S]{0,200}lampFromState\(snapshot\.qbo\.state\)/,
    );

    const probeSrc = readFileSync(
      join(process.cwd(), "src/server/integrations/qbo/live-token-probe.ts"),
      "utf8",
    );
    expect(probeSrc).toContain("invalid_client");
    expect(probeSrc).toContain("Reconnect Required");
    expect(probeSrc).toContain("60_000");
  });
});

describe("Katana inbound sync + showroom staleness badge", () => {
  it("manual sync path awaits inbound pull (not enqueue-only)", () => {
    const snap = readFileSync(
      join(process.cwd(), "src/server/stock/showroom-snapshot.ts"),
      "utf8",
    );
    expect(snap).toContain("refreshShowroomSnapshotFromKatana");
    expect(snap).toContain("syncedItemsCount");
    expect(snap).toContain("awaitShowroomSyncUnderLock");
    // Executive reset must NOT only enqueue
    const resetFn = snap.slice(snap.indexOf("export async function resetBucketAndSyncKatanaNow"));
    expect(resetFn).toContain("refreshShowroomSnapshotFromKatana");
    expect(resetFn).not.toContain("enqueueBackgroundShowroomSync");

    const actions = readFileSync(
      join(process.cwd(), "src/app/embed/admin/master-catalog/actions.ts"),
      "utf8",
    );
    expect(actions).toContain("syncKatanaInventoryNow");
    expect(actions).toContain("syncedItemsCount");
    // Inbound pull is explicitly not gated by DOWNSTREAM_MUTATIONS
    expect(actions).toMatch(/DOWNSTREAM_MUTATIONS/);

    const api = readFileSync(
      join(process.cwd(), "src/app/api/stack/katana-sync/route.ts"),
      "utf8",
    );
    expect(api).toContain("maxDuration = 60");
    expect(api).toContain("syncedItemsCount");
  });

  it("showroom badge is Red (not Amber) when last_synced_at is > 2h old", () => {
    const now = Date.parse("2026-11-25T20:00:00.000Z");
    const staleAt = new Date(now - HUB_SYNC_STALE_MS - 60_000).toISOString();
    const badge = resolveHubSyncBadge(staleAt, now);
    expect(badge.tone).toBe("red");
    expect(badge.statusLabel).toBe("Snapshot Stale — Refresh");
    expect(badge.showRefreshButton).toBe(true);

    const amberAt = new Date(now - HUB_SYNC_FRESH_MS - 60_000).toISOString();
    expect(resolveHubSyncBadge(amberAt, now).tone).toBe("amber");

    const freshAt = new Date(now - 5_000).toISOString();
    const fresh = resolveHubSyncBadge(freshAt, now);
    expect(fresh.tone).toBe("green");
    expect(fresh.statusLabel).toContain("Synced just now");
  });
});

describe("DLQ parity + drawer close UX wiring", () => {
  it("open DLQ list and stackHealth share the same open predicate", () => {
    expect(DLQ_STATUS_OPEN).toBe("open");
    expect(openDlqStatusPredicate()).toBeTruthy();

    const actions = readFileSync(
      join(process.cwd(), "src/app/embed/admin/master-catalog/actions.ts"),
      "utf8",
    );
    expect(actions).toContain("openDlqStatusPredicate");
    expect(actions).toContain("openDlqCount");
    expect(actions).toContain("Healthy · 0 open DLQ");

    const strip = readFileSync(
      join(
        process.cwd(),
        "src/app/embed/admin/master-catalog/ecommerce/ExecutiveStackHealthStrip.tsx",
      ),
      "utf8",
    );
    expect(strip).toContain('data-testid="stack-drawer-close"');
    expect(strip).toContain('event.key === "Escape"');
    expect(strip).toContain('actionId.startsWith("dlq_")');
    expect(strip).toContain("await refresh()");
  });
});

describe("Woo HTML strip + FedEx Amber dims-only", () => {
  it("strips <p> tags from Woo summary and keeps raw in rawBody", () => {
    const classified = classifyWooProbeBody({
      httpStatus: 500,
      contentType: "application/json",
      host: "ccpatiodev2.primeview.com",
      bodyText: JSON.stringify({
        code: "internal_server_error",
        message: "<p>There has been a critical error on this website.</p>",
      }),
    });
    expect(classified.ok).toBe(false);
    expect(classified.label).toContain("WordPress PHP Critical Error");
    expect(classified.label).toContain("ccpatiodev2.primeview.com");
    expect(classified.label).not.toContain("<p>");
    expect(classified.snippet).not.toMatch(/<p>/i);
    expect(classified.rawBody).toContain("internal_server_error");
    expect(stripHtmlSnippet("<p>Hello</p>")).toBe("Hello");
  });

  it("FedEx dims-only is Degraded (Amber Readiness Warning) and navigates to Missing Dims", () => {
    const actions = readFileSync(
      join(process.cwd(), "src/app/embed/admin/master-catalog/actions.ts"),
      "utf8",
    );
    expect(actions).toContain("Readiness Warning");
    expect(actions).toContain("missing freight dims");
    expect(actions).toContain("fedex_view_missing_dims");

    const portal = readFileSync(
      join(
        process.cwd(),
        "src/app/embed/admin/master-catalog/ecommerce/EcommerceCertificationPortal.tsx",
      ),
      "utf8",
    );
    expect(portal).toContain('actionId === "fedex_view_missing_dims"');
    expect(portal).toContain('setTab("products")');
    expect(portal).toContain('setReadinessFilter("missing_dims")');

    const strip = readFileSync(
      join(
        process.cwd(),
        "src/app/embed/admin/master-catalog/ecommerce/ExecutiveStackHealthStrip.tsx",
      ),
      "utf8",
    );
    expect(strip).toContain("<details");
    expect(strip).toContain("Raw diagnostic");
  });
});

describe("probeLiveQboToken cache helper exports", () => {
  it("exports clear + probe", () => {
    expect(typeof probeLiveQboToken).toBe("function");
    expect(typeof clearQboLiveProbeCache).toBe("function");
  });
});

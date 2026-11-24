import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildQboAuthorizeUrl,
  fingerprintUpstreamBody,
  isAllowedQboRealmId,
  isValidQboConnectSecret,
  mintQboOAuthState,
  oauthStateMatches,
  QBO_AUTHORIZE_URL,
  QBO_OAUTH_STATE_COOKIE,
  qboOAuthStateCookieOptions,
  sanitizedQboOAuthError,
} from "@/server/integrations/qbo/oauth";

describe("QBO OAuth state cookie helpers", () => {
  it("mints unpredictable hex state and SameSite=Lax HttpOnly cookie opts", () => {
    const a = mintQboOAuthState();
    const b = mintQboOAuthState();
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(a).not.toBe(b);
    expect(qboOAuthStateCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 600,
    });
    expect(QBO_OAUTH_STATE_COOKIE).toBe("qbo_oauth_state");
  });

  it("rejects state mismatches and empties", () => {
    expect(oauthStateMatches("abc", "abc")).toBe(true);
    expect(oauthStateMatches("abc", "abd")).toBe(false);
    expect(oauthStateMatches("", "abc")).toBe(false);
    expect(oauthStateMatches("abc", "")).toBe(false);
    expect(oauthStateMatches(null, "abc")).toBe(false);
  });
});

describe("QBO realm + connect secret gates", () => {
  it("allows any realm when QBO_EXPECTED_REALM_ID is unset", () => {
    expect(isAllowedQboRealmId("913034761234567", {})).toBe(true);
  });

  it("rejects non-matching realm when expected is configured", () => {
    const env = { QBO_EXPECTED_REALM_ID: "913034761234567" };
    expect(isAllowedQboRealmId("913034761234567", env)).toBe(true);
    expect(isAllowedQboRealmId("999999999999999", env)).toBe(false);
  });

  it("validates connect secret fail-closed", () => {
    expect(isValidQboConnectSecret("secret", {})).toBe(false);
    expect(isValidQboConnectSecret("secret", { QBO_CONNECT_SECRET: "secret" })).toBe(true);
    expect(isValidQboConnectSecret("wrong", { QBO_CONNECT_SECRET: "secret" })).toBe(false);
    expect(isValidQboConnectSecret("", { QBO_CONNECT_SECRET: "secret" })).toBe(false);
  });
});

describe("QBO authorize URL + sanitized errors", () => {
  it("builds Intuit appcenter authorize URL with state", () => {
    const url = buildQboAuthorizeUrl({
      clientId: "cid",
      redirectUri: "https://hub.ccpatio.com/api/auth/qbo/callback",
      state: "deadbeef",
    });
    expect(url.startsWith(QBO_AUTHORIZE_URL)).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("cid");
    expect(parsed.searchParams.get("state")).toBe("deadbeef");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toContain("com.intuit.quickbooks.accounting");
  });

  it("never echoes upstream payloads in browser errors", () => {
    const body = sanitizedQboOAuthError("token_exchange_failed", "Token exchange failed");
    expect(body).toEqual({ error: "Token exchange failed", code: "token_exchange_failed" });
    expect(JSON.stringify(body)).not.toContain("intuit");
    expect(fingerprintUpstreamBody('{"error":"invalid_grant"}')).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("GET /api/auth/qbo/callback route hardening", () => {
  const cookieStore = { get: vi.fn() };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    cookieStore.get.mockReset();
  });

  async function loadRoute(opts: {
    cookieState?: string | null;
    fetchImpl?: typeof fetch;
    dbInsert?: ReturnType<typeof vi.fn>;
  }) {
    cookieStore.get.mockReturnValue(
      opts.cookieState ? { value: opts.cookieState } : undefined,
    );
    vi.doMock("next/headers", () => ({
      cookies: async () => cookieStore,
    }));
    const insert = opts.dbInsert ?? vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    });
    vi.doMock("@/server/db/client", () => ({
      getDb: () => ({ insert }),
    }));
    vi.doMock("@/server/integrations/qbo/client", () => ({
      getQboTokenId: () => true,
    }));
    vi.stubGlobal("fetch", opts.fetchImpl ?? vi.fn());
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_CLIENT_SECRET = "csecret";
    process.env.QBO_OAUTH_REDIRECT_URI = "https://hub.ccpatio.com/api/auth/qbo/callback";
    const mod = await import("@/app/api/auth/qbo/callback/route");
    return { GET: mod.GET, insert };
  }

  it("returns 403 on state mismatch without writing tokens", async () => {
    const { GET, insert } = await loadRoute({ cookieState: "good-state" });
    const res = await GET(
      new Request(
        "https://hub.ccpatio.com/api/auth/qbo/callback?code=x&realmId=1&state=bad-state",
      ),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toEqual({ error: "Invalid OAuth state", code: "state_mismatch" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns 403 for unexpected realmId before DB write", async () => {
    process.env.QBO_EXPECTED_REALM_ID = "expected-realm";
    const { GET, insert } = await loadRoute({ cookieState: "state-1" });
    const res = await GET(
      new Request(
        "https://hub.ccpatio.com/api/auth/qbo/callback?code=x&realmId=other-realm&state=state-1",
      ),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("realm_rejected");
    expect(insert).not.toHaveBeenCalled();
    delete process.env.QBO_EXPECTED_REALM_ID;
  });

  it("sanitizes Intuit token-exchange failures (no details echo)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"invalid_grant","error_description":"Token invalid"}',
    });
    const { GET, insert } = await loadRoute({ cookieState: "state-1", fetchImpl });
    const res = await GET(
      new Request(
        "https://hub.ccpatio.com/api/auth/qbo/callback?code=x&realmId=r1&state=state-1",
      ),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      error: "Token exchange failed",
      code: "token_exchange_failed",
    });
    expect(JSON.stringify(json)).not.toContain("invalid_grant");
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth/qbo/connect route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("redirects to Intuit with state cookie when connect secret is valid", async () => {
    process.env.QBO_CONNECT_SECRET = "ops-secret";
    process.env.QBO_CLIENT_ID = "cid";
    process.env.QBO_OAUTH_REDIRECT_URI = "https://hub.ccpatio.com/api/auth/qbo/callback";

    vi.doMock("@/utils/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: null } }) },
      }),
    }));
    vi.doMock("@/server/db/client", () => ({ getDb: () => ({}) }));

    const { GET } = await import("@/app/api/auth/qbo/connect/route");
    const res = await GET(
      new Request("https://hub.ccpatio.com/api/auth/qbo/connect?secret=ops-secret"),
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith(QBO_AUTHORIZE_URL)).toBe(true);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("qbo_oauth_state=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
    delete process.env.QBO_CONNECT_SECRET;
  });

  it("rejects unauthorized connect with 403", async () => {
    delete process.env.QBO_CONNECT_SECRET;
    vi.doMock("@/utils/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: null } }) },
      }),
    }));
    vi.doMock("@/server/db/client", () => ({ getDb: () => ({}) }));
    const { GET } = await import("@/app/api/auth/qbo/connect/route");
    const res = await GET(new Request("https://hub.ccpatio.com/api/auth/qbo/connect"));
    expect(res.status).toBe(403);
  });
});

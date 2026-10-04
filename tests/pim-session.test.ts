import { beforeEach, describe, expect, it, vi } from "vitest";

// Request-scope mocks: the embed context header + a valid embed key are ALWAYS present,
// exactly as inside the GHL iframe. Only the Supabase user varies per test.
const req = vi.hoisted(() => ({
  headers: new Map<string, string>(),
  cookies: new Map<string, string>(),
  user: null as { id: string; email: string | null } | null,
  getUserThrows: false,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (req.cookies.has(k) ? { value: req.cookies.get(k) } : undefined) }),
  headers: async () => ({ get: (k: string) => req.headers.get(k.toLowerCase()) ?? null }),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        if (req.getUserThrows) throw new Error("auth unavailable");
        return { data: { user: req.user } };
      },
    },
  }),
}));

vi.mock("@/lib/embed-auth", () => ({
  EMBED_AUTH_COOKIE: "ccpatio-embed-auth",
  EMBED_KEY_HEADER: "x-ccpatio-embed-key",
  EMBED_CONTEXT_HEADER: "x-ccpatio-embed",
  getGhlEmbedSecret: () => "secret",
  embedKeyIsValid: (key: string | null) => key === "good-key",
}));

vi.mock("@/lib/e2e-god-mode", () => ({
  E2E_GODMODE_COOKIE: "ccpatio_e2e_godmode",
  getE2eGodModeSecret: () => "e2e",
  verifyE2eGodModeCookie: async () => null,
}));

import { GHL_EMBED_PRINCIPAL_EMAIL, getPimSession, isEmbedPrincipal } from "@/lib/pim-audit";

describe("getPimSession: a human Supabase session outranks the GHL embed principal", () => {
  beforeEach(() => {
    req.headers = new Map([
      ["x-ccpatio-embed", "1"],
      ["x-ccpatio-embed-key", "good-key"],
    ]);
    req.cookies = new Map();
    req.user = null;
    req.getUserThrows = false;
  });

  it("returns the human operator inside the embed iframe when a Supabase user exists", async () => {
    req.user = { id: "u1", email: "ops@ccpatio.com" };
    const s = await getPimSession();
    expect(s?.email).toBe("ops@ccpatio.com");
    expect(isEmbedPrincipal(s)).toBe(false);
  });

  it("falls back to the embed principal only when there is no human session", async () => {
    const s = await getPimSession();
    expect(s?.email).toBe(GHL_EMBED_PRINCIPAL_EMAIL);
    expect(isEmbedPrincipal(s)).toBe(true);
  });

  it("falls back to the embed principal when Supabase auth itself errors", async () => {
    req.getUserThrows = true;
    expect((await getPimSession())?.email).toBe(GHL_EMBED_PRINCIPAL_EMAIL);
  });

  it("ignores a user without an email and an invalid embed key", async () => {
    req.user = { id: "u2", email: null };
    req.headers.set("x-ccpatio-embed-key", "wrong");
    expect(await getPimSession()).toBeNull();
  });

  it("returns a human session outside the embed context unchanged", async () => {
    req.headers = new Map();
    req.user = { id: "u3", email: "sales@ccpatio.com" };
    expect((await getPimSession())?.email).toBe("sales@ccpatio.com");
  });

  it("returns null with no human and no embed context", async () => {
    req.headers = new Map();
    expect(await getPimSession()).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({
  headers: new Map<string, string>(),
  cookies: new Map<string, string>(),
  user: null as { id: string; email: string | null } | null,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (req.cookies.has(k) ? { value: req.cookies.get(k) } : undefined) }),
  headers: async () => ({ get: (k: string) => req.headers.get(k.toLowerCase()) ?? null }),
}));

vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: req.user } }),
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

// Mock upstream server modules
let opportunitiesShouldFail = false;
vi.mock("@/server/ghl/search-opportunities", () => {
  const { UpstreamBusyError } = vi.importActual("@/server/ghl/search-opportunities") as any;
  return {
    UpstreamBusyError: class UpstreamBusyError extends Error {
      code = "UPSTREAM_BUSY";
      constructor() {
        super("GoHighLevel is busy. Try again in a moment.");
      }
    },
    searchOpportunities: vi.fn(async (q: string) => {
      if (opportunitiesShouldFail) {
        throw new (class extends Error {
          name = "UpstreamBusyError";
          code = "UPSTREAM_BUSY";
          constructor() {
            super("GHL 502 Bad Gateway downstream socket hang up");
          }
        })();
      }
      return [
        { id: "opp-1", name: `Project ${q}`, contactName: "Alice", valueCents: 500000 },
      ];
    }),
  };
});

vi.mock("@/server/factory-bom/intake/finishes", () => ({
  searchFinishes: vi.fn(async (kind: string, _q?: string) => [
    { sku: `${kind.toUpperCase()}-001`, name: `Sample ${kind}` },
  ]),
}));

vi.mock("@/server/factory-bom/intake/project-status", () => ({
  loadProjectStatus: vi.fn(async (_oppId: string) => ({
    jobExists: true,
    clientCode: "SMITH",
    pieces: [{ name: "Dining Table", quantity: 1 }],
    locked: false,
  })),
}));

vi.mock("@/server/master-catalog/sku-preview", () => ({
  previewSku: vi.fn(async (name: string) => ({
    sku: "FIN-MAL-SOF-96X38",
    collectionLabel: "Malibu",
    categoryLabel: "Sofa",
    isCollision: false,
  })),
}));

vi.mock("@/server/db/client", () => {
  const fakeDb: any = {
    query: {
      sku_mappings: {
        findMany: vi.fn(async () => []),
      },
    },
  };
  return { getDb: vi.fn(() => fakeDb) };
});

import { GET as opportunitiesGet } from "@/app/embed/factory-bom/api/opportunities/route";
import { GET as finishesGet } from "@/app/embed/factory-bom/api/finishes/route";
import { GET as skuCheckGet } from "@/app/embed/factory-bom/api/sku-check/route";

describe("Embed API Route Handlers (Task 9.2 & 9.4)", () => {
  beforeEach(() => {
    req.headers = new Map([
      ["x-ccpatio-embed", "1"],
      ["x-ccpatio-embed-key", "good-key"],
    ]);
    req.cookies = new Map();
    req.user = null;
    opportunitiesShouldFail = false;
  });

  describe("opportunities route", () => {
    it("(a) returns 401 when no session exists", async () => {
      req.headers = new Map();
      const res = await opportunitiesGet(new Request("https://localhost/embed/factory-bom/api/opportunities?q=smith"));
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.code).toBe("NOT_SIGNED_IN");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it("(b) returns 401 when embed principal is presented WITHOUT the context header", async () => {
      // Simulate call from outside /embed (has key header but NO x-ccpatio-embed header)
      req.headers = new Map([["x-ccpatio-embed-key", "good-key"]]);
      const res = await opportunitiesGet(new Request("https://localhost/embed/factory-bom/api/opportunities?q=smith"));
      expect(res.status).toBe(401);
    });

    it("(c) returns 200 with valid embed principal with context header", async () => {
      const res = await opportunitiesGet(new Request("https://localhost/embed/factory-bom/api/opportunities?q=smith"));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.results.length).toBe(1);
      expect(res.headers.get("cache-control")).toBe("private, max-age=30");
      expect(res.headers.get("vary")).toBe("Cookie");
    });

    it("(d) returns 400 on validation error (q too short)", async () => {
      const res = await opportunitiesGet(new Request("https://localhost/embed/factory-bom/api/opportunities?q=a"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("VALIDATION");
    });

    it("(e) upstream failure yields 503 with Retry-After and no upstream text in body", async () => {
      opportunitiesShouldFail = true;
      const res = await opportunitiesGet(new Request("https://localhost/embed/factory-bom/api/opportunities?q=smith"));
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("5");
      const json = await res.json();
      expect(json.code).toBe("UPSTREAM_BUSY");
      expect(JSON.stringify(json)).not.toContain("downstream socket hang up");
    });
  });

  describe("finishes route", () => {
    it("returns 401 when unauthenticated", async () => {
      req.headers = new Map();
      const res = await finishesGet(new Request("https://localhost/embed/factory-bom/api/finishes?kind=frame"));
      expect(res.status).toBe(401);
    });

    it("returns 200 with private cache 300s", async () => {
      const res = await finishesGet(new Request("https://localhost/embed/factory-bom/api/finishes?kind=frame"));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, max-age=300");
      expect(res.headers.get("vary")).toBe("Cookie");
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.results[0].sku).toBe("FRAME-001");
    });

    it("returns 400 on invalid kind", async () => {
      const res = await finishesGet(new Request("https://localhost/embed/factory-bom/api/finishes?kind=plastic"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("VALIDATION");
    });
  });

  describe("sku-check route", () => {
    it("returns 401 when unauthenticated", async () => {
      req.headers = new Map();
      const res = await skuCheckGet(new Request("https://localhost/embed/factory-bom/api/sku-check?mode=client&opp=opp-1&piece=Chair"));
      expect(res.status).toBe(401);
    });

    it("returns 200 with no-store cache on client mode check", async () => {
      const res = await skuCheckGet(new Request("https://localhost/embed/factory-bom/api/sku-check?mode=client&opp=opp-1&piece=Chair"));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.project).toBeDefined();
      expect(json.itemCode).toBe("CHAIR");
    });

    it("returns 200 with no-store cache on catalog mode check", async () => {
      const res = await skuCheckGet(
        new Request("https://localhost/embed/factory-bom/api/sku-check?mode=catalog&col=MAL&colLabel=Malibu&cat=SOF&name=Malibu+Sofa&l=96&d=38")
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.sku).toBe("FIN-MAL-SOF-96X38");
      expect(json.collision).toBe(false);
    });
  });
});

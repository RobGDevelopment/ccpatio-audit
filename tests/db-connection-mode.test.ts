import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMutexConnection } from "@/server/db/client";

const TX = "postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:6543/postgres";
const SESSION = "postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:5432/postgres";
const DIRECT = "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres";

describe("resolveMutexConnection", () => {
  it("prefers POSTGRES_URL_TX and reports the transaction pooler", () => {
    const r = resolveMutexConnection({ POSTGRES_URL_TX: TX, POSTGRES_URL: SESSION });
    expect(r).toEqual({ url: TX, mode: "transaction-pooler", source: "POSTGRES_URL_TX" });
  });

  it("accepts a direct connection in POSTGRES_URL_TX with no warning", () => {
    const r = resolveMutexConnection({ POSTGRES_URL_TX: DIRECT });
    expect(r.mode).toBe("direct");
    expect(r.warning).toBeUndefined();
  });

  it("rejects the session pooler (5432) as the dedicated mutex URL", () => {
    expect(() => resolveMutexConnection({ POSTGRES_URL_TX: SESSION })).toThrow(/session pooler/);
  });

  it("falls back to POSTGRES_URL on the session pooler but warns about max clients", () => {
    const r = resolveMutexConnection({ POSTGRES_URL: SESSION });
    expect(r.source).toBe("POSTGRES_URL");
    expect(r.mode).toBe("session-pooler");
    expect(r.warning).toMatch(/max clients reached/);
  });

  it("falls back to POSTGRES_URL on the transaction pooler with no warning", () => {
    const r = resolveMutexConnection({ POSTGRES_URL: TX });
    expect(r.mode).toBe("transaction-pooler");
    expect(r.warning).toBeUndefined();
  });

  it("ignores a blank POSTGRES_URL_TX", () => {
    expect(resolveMutexConnection({ POSTGRES_URL_TX: "  ", POSTGRES_URL: DIRECT }).source).toBe(
      "POSTGRES_URL",
    );
  });

  it("throws when nothing is configured", () => {
    expect(() => resolveMutexConnection({})).toThrow(/POSTGRES_URL is not set/);
  });

  it("throws on a malformed URL without echoing it", () => {
    expect(() => resolveMutexConnection({ POSTGRES_URL: "not a url" })).toThrow(
      /not a valid URL/,
    );
  });
});

describe("getDb client options (D2: CLI scripts must be able to exit)", () => {
  const savedUrl = process.env.POSTGRES_URL;
  afterEach(() => {
    if (savedUrl === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = savedUrl;
    vi.doUnmock("postgres");
    vi.doUnmock("drizzle-orm/postgres-js");
    vi.resetModules();
  });

  it("passes idle_timeout and connect_timeout and keeps prepare:false on the default client", async () => {
    vi.resetModules();
    const postgresSpy = vi.fn(() => ({ end: async () => undefined }));
    vi.doMock("postgres", () => ({ default: postgresSpy }));
    vi.doMock("drizzle-orm/postgres-js", () => ({ drizzle: () => ({}) }));
    process.env.POSTGRES_URL = TX;

    const { getDb } = await import("@/server/db/client");
    getDb();

    expect(postgresSpy).toHaveBeenCalledTimes(1);
    const [url, options] = postgresSpy.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe(TX);
    expect(options).toMatchObject({ prepare: false, idle_timeout: 20, connect_timeout: 10 });
  });

  it("still throws a clear error (without echoing a URL) when POSTGRES_URL is unset", async () => {
    vi.resetModules();
    delete process.env.POSTGRES_URL;
    const { getDb } = await import("@/server/db/client");
    expect(() => getDb()).toThrow(/POSTGRES_URL is not set/);
  });
});

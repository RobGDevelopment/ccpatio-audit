import { describe, expect, it } from "vitest";
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

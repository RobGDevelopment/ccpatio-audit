import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ghlGet, ghlPost } from "@/server/ghl/private-api";

const SECRET_TEXT = "Bearer abc.def.ghi leaked-token-123";
const PRIVATE_API = path.resolve(__dirname, "..", "src/server/ghl/private-api.ts");

function logged(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

describe("ghl private-api: no bare catch, no leaked provider text", () => {
  const OLD = {
    token: process.env.GHL_PRIVATE_INTEGRATION_TOKEN,
    location: process.env.GHL_LOCATION_ID,
  };

  beforeEach(() => {
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "unit-test-token";
    process.env.GHL_LOCATION_ID = "loc-1";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (OLD.token === undefined) delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    else process.env.GHL_PRIVATE_INTEGRATION_TOKEN = OLD.token;
    if (OLD.location === undefined) delete process.env.GHL_LOCATION_ID;
    else process.env.GHL_LOCATION_ID = OLD.location;
  });

  it("source has no bare catch and binds every caught error", () => {
    const source = readFileSync(PRIVATE_API, "utf8");
    expect(source).not.toMatch(/catch\s*\{/);
    expect(source).not.toMatch(/\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(undefined|null|""|\{\s*\})/);
    expect(source).not.toMatch(/\berror\.message\b|\.stack\b/);
    expect((source.match(/catch\s*\(\s*\w+(?:\s*:\s*unknown)?\s*\)\s*\{/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("a transport failure returns a ref, logs a fingerprint, and never echoes the error text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(SECRET_TEXT)));

    const result = await ghlGet("/contacts/c-123?query=jane@example.com");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/^GoHighLevel request failed\. Reference [0-9a-f]{12}\.$/);
    expect(result.error).not.toContain("leaked-token-123");

    const raw = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(raw).not.toContain("leaked-token-123");
    expect(raw).not.toContain("jane@example.com");
    expect(raw).not.toContain("c-123");
    const [line] = logged(errorSpy);
    expect(line).toMatchObject({
      tag: "ghl-request-failed",
      level: "error",
      method: "GET",
      route: "contacts",
      errorName: "TypeError",
    });
    expect(line).not.toHaveProperty("message");
    expect(line).not.toHaveProperty("stack");
  });

  it("a refused request returns the status only, not the provider message", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: SECRET_TEXT }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await ghlPost("/contacts/c-9/notes", { body: "x" });

    expect(result).toEqual({ ok: false, error: "GoHighLevel returned 422." });
    const raw = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(raw).not.toContain("leaked-token-123");
    expect(logged(warnSpy)[0]).toMatchObject({
      tag: "ghl-request-refused",
      method: "POST",
      route: "contacts",
      status: 422,
    });
  });

  it("a non-JSON body on a refusal is logged by fingerprint and still reports the status", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(`<html>${SECRET_TEXT}</html>`, { status: 502 })),
    );

    const result = await ghlGet("/opportunities/o-1");

    expect(result).toEqual({ ok: false, error: "GoHighLevel returned 502." });
    const raw = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(raw).not.toContain("leaked-token-123");
    expect(logged(errorSpy)[0]).toMatchObject({
      tag: "ghl-response-not-json",
      errorName: "SyntaxError",
      status: 502,
    });
  });

  it("a non-JSON body on a 200 is a failure, not a fabricated success body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>ok</html>", { status: 200 })));

    const result = await ghlGet("/users/u-1");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/^GoHighLevel returned an unreadable response\. Reference [0-9a-f]{12}\.$/);
  });

  it("a good JSON response still succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ contact: { id: "c-1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const result = await ghlGet("/contacts/c-1");

    expect(result).toEqual({ ok: true, body: { contact: { id: "c-1" } }, locationId: "loc-1" });
  });
});

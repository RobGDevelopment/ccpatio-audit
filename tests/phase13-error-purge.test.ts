import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.hoisted(() => vi.fn());
vi.mock("@/inngest/client", () => ({
  inngest: { send: sendMock, createFunction: vi.fn(() => ({})) },
}));
vi.mock("@/server/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/server/alerts/oh-crap", () => ({ sendOhCrapAlert: vi.fn() }));

const katana = vi.hoisted(() => ({
  verify: vi.fn(() => true),
  readHoldDeletion: vi.fn(() => ({ kind: "ignore" }) as unknown),
  readVariantUpdate: vi.fn(),
  loadSku: vi.fn(),
  heal: vi.fn(),
}));
vi.mock("@/server/katana/variant-webhook", () => ({
  verifyKatanaWebhookSignature: katana.verify,
  readHoldDeletion: katana.readHoldDeletion,
  readVariantUpdate: katana.readVariantUpdate,
  loadKatanaVariantSku: katana.loadSku,
  healKatanaVariantSku: katana.heal,
}));
vi.mock("@/server/stock/release-hold", () => ({ releaseDeletedHoldDocument: vi.fn() }));
vi.mock("@/lib/pim-audit", () => ({ logPimAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { classifyAlertFailure } from "@/inngest/dlq";
import { fingerprintError, logError, logStructured } from "@/lib/log/structured";

const ROOT = path.resolve(__dirname, "..");
const SECRET_TEXT = "Bearer abc.def.ghi leaked-token-123";

function captured(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

describe("structured logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never writes err.message or err.stack, only name, code and a digest", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new TypeError(SECRET_TEXT), { code: "ECONNRESET" });
    const ref = logError("unit-failure", error, { where: "test" });

    const raw = String(spy.mock.calls[0]![0]);
    expect(raw).not.toContain("leaked-token-123");
    expect(raw).not.toContain("at "); // no stack frames
    const line = JSON.parse(raw) as Record<string, unknown>;
    expect(line).toMatchObject({
      tag: "unit-failure",
      level: "error",
      where: "test",
      errorName: "TypeError",
      errorCode: "ECONNRESET",
      ref,
    });
    expect(line).not.toHaveProperty("message");
    expect(line).not.toHaveProperty("stack");
  });

  it("strips message/stack keys a caller passes by mistake", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logStructured("warn", "oops", { message: "secret", stack: "trace", keep: 1 });
    const [line] = captured(spy);
    expect(line).toMatchObject({ tag: "oops", keep: 1 });
    expect(line).not.toHaveProperty("message");
    expect(line).not.toHaveProperty("stack");
  });

  it("ref is stable for the same failure and differs across failures", () => {
    expect(fingerprintError(new Error("a")).ref).toBe(fingerprintError(new Error("a")).ref);
    expect(fingerprintError(new Error("a")).ref).not.toBe(fingerprintError(new Error("b")).ref);
    expect(fingerprintError("plain string").errorName).toBe("string");
  });

  it("rejects a free-text `code` so provider prose cannot ride in the code field", () => {
    const error = Object.assign(new Error("x"), { code: "this is a sentence with spaces" });
    expect(fingerprintError(error).errorCode).toBeNull();
  });
});

describe("DLQ alert failure classification", () => {
  it("maps provider text to a code and hides the text", () => {
    expect(classifyAlertFailure("OH_CRAP_ADMIN_EMAIL is not set").alertFailure).toBe(
      "ADMIN_EMAIL_NOT_CONFIGURED",
    );
    expect(classifyAlertFailure("Resend failed (422): bad from address").alertFailure).toBe(
      "RESEND_HTTP_422",
    );
    const other = classifyAlertFailure(SECRET_TEXT);
    expect(other.alertFailure).toBe("ALERT_TRANSPORT_FAILED");
    expect(JSON.stringify(other)).not.toContain("leaked-token-123");
  });
});

describe("money-path static guards", () => {
  const files = [
    "src/app/api/webhooks/clover/route.ts",
    "src/app/api/webhooks/katana/route.ts",
    "src/app/api/webhooks/ghl/route.ts",
    "src/server/integrations/qbo/token-refresh.ts",
    "src/inngest/dlq.ts",
    "src/server/ghl/private-api.ts",
  ];

  for (const file of files) {
    const source = readFileSync(path.join(ROOT, file), "utf8");

    it(`${file}: no bare catch, no swallowing .catch`, () => {
      expect(source).not.toMatch(/catch\s*\{/);
      expect(source).not.toMatch(/\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(undefined|null|""|\{\s*\})/);
    });

    it(`${file}: no console.* call that interpolates err.message or err.stack`, () => {
      const consoleCalls = source.match(/console\.(?:log|warn|error)\([\s\S]*?\);/g) ?? [];
      for (const call of consoleCalls) {
        expect(call).not.toMatch(/\.message|\.stack/);
      }
    });

    it(`${file}: every catch binds its error`, () => {
      const catches = source.match(/catch\s*\(\s*(\w+)\s*\)\s*\{/g) ?? [];
      expect(catches.length).toBeGreaterThan(0);
    });
  }
});

describe("POST /api/webhooks/clover", () => {
  const OLD_SECRET = process.env.CLOVER_WEBHOOK_SECRET;

  beforeEach(() => {
    sendMock.mockReset();
    process.env.CLOVER_WEBHOOK_SECRET = "clover-secret";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (OLD_SECRET === undefined) delete process.env.CLOVER_WEBHOOK_SECRET;
    else process.env.CLOVER_WEBHOOK_SECRET = OLD_SECRET;
  });

  async function post(body: string, headers: Record<string, string> = {}) {
    const { POST } = await import("@/app/api/webhooks/clover/route");
    return POST(new Request("http://localhost/api/webhooks/clover", { method: "POST", body, headers }));
  }

  const payment = JSON.stringify({
    merchants: { M1: [{ type: "CREATE", objectId: "P:ABC" }, { type: "UPDATE", objectId: "P:ZZZ" }] },
  });

  it("400 on unparseable JSON, and does not dispatch", async () => {
    const res = await post("{not json", { "x-clover-auth": "clover-secret" });
    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("401 on a wrong or missing auth header", async () => {
    expect((await post(payment, { "x-clover-auth": "nope" })).status).toBe(401);
    expect((await post(payment)).status).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("500 (so Clover retries) when the secret is not configured", async () => {
    delete process.env.CLOVER_WEBHOOK_SECRET;
    const res = await post(payment, { "x-clover-auth": "clover-secret" });
    expect(res.status).toBe(500);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("200 and dispatches one idempotent event per CREATE payment", async () => {
    sendMock.mockResolvedValue({ ids: ["1"] });
    const res = await post(payment, { "x-clover-auth": "clover-secret" });
    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith([
      {
        id: "clover:M1:P:ABC",
        name: "clover/payment.created",
        data: { merchantId: "M1", paymentId: "P:ABC" },
      },
    ]);
  });

  it("500 with a ref and NO provider text when Inngest is down", async () => {
    sendMock.mockRejectedValue(new Error(SECRET_TEXT));
    const res = await post(payment, { "x-clover-auth": "clover-secret" });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("leaked-token-123");
    expect(JSON.parse(text)).toMatchObject({ error: "internal_error" });
    expect(JSON.parse(text).ref).toMatch(/^[0-9a-f]{12}$/);
  });

  it("acknowledges the verification ping without auth", async () => {
    const res = await post(JSON.stringify({ verificationCode: "abc-123" }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/webhooks/katana", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    katana.verify.mockReset().mockReturnValue(true);
    katana.readHoldDeletion.mockReset().mockReturnValue({ kind: "ignore" });
    katana.readVariantUpdate.mockReset();
    katana.loadSku.mockReset();
    katana.heal.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  async function post(body: string) {
    const { POST } = await import("@/app/api/webhooks/katana/route");
    return POST(new Request("http://localhost/api/webhooks/katana", { method: "POST", body }));
  }

  it("401 on a bad signature", async () => {
    katana.verify.mockReturnValue(false);
    const res = await post("{}");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
  });

  it("400 on a signed body that is not JSON", async () => {
    const res = await post("<<<");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_json");
  });

  it("502 on a Katana lookup failure, without leaking the upstream text", async () => {
    katana.readVariantUpdate.mockReturnValue({ kind: "update", variantId: 7, sku: null });
    katana.loadSku.mockRejectedValue(new Error(SECRET_TEXT));
    const res = await post("{}");
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("leaked-token-123");
    expect(JSON.parse(text)).toMatchObject({ error: "variant_lookup_failed" });
  });

  it("500 with a ref on any unexpected fault (Katana retries 5xx)", async () => {
    katana.readVariantUpdate.mockReturnValue({ kind: "update", variantId: 7, sku: "SKU-1" });
    katana.heal.mockRejectedValue(new Error("db down"));
    const res = await post("{}");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; ref: string };
    expect(body.error).toBe("internal_error");
    expect(body.ref).toMatch(/^[0-9a-f]{12}$/);
  });
});

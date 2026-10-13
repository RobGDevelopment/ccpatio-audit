import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  WOO_ORDER_EVENT,
  isWooPingBody,
  verifyWooWebhookSignature,
  wooDeliveryKey,
  wooEventId,
} from "@/server/woocommerce/ingress";

const SECRET = "woo-test-secret";
const BODY = JSON.stringify({ id: 981, status: "processing" });
const b64 = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("base64");
const hex = (body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(body, "utf8").digest("hex");

describe("verifyWooWebhookSignature", () => {
  it("accepts the base64 HMAC-SHA256 of the raw body", () => {
    expect(verifyWooWebhookSignature(BODY, b64(BODY), SECRET)).toBe(true);
  });

  it("tolerates surrounding whitespace on the header and secret", () => {
    expect(verifyWooWebhookSignature(BODY, `  ${b64(BODY)}\n`, SECRET)).toBe(true);
    expect(verifyWooWebhookSignature(BODY, b64(BODY), `  ${SECRET}\n`)).toBe(true);
  });

  it("rejects a hex digest (WooCommerce never sends hex)", () => {
    expect(verifyWooWebhookSignature(BODY, hex(BODY), SECRET)).toBe(false);
  });

  it("rejects a sha256= prefix and a bare bearer-style secret", () => {
    expect(verifyWooWebhookSignature(BODY, `sha256=${b64(BODY)}`, SECRET)).toBe(false);
    expect(verifyWooWebhookSignature(BODY, SECRET, SECRET)).toBe(false);
    expect(verifyWooWebhookSignature(BODY, `Bearer ${SECRET}`, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyWooWebhookSignature(BODY, b64(BODY, "other-secret"), SECRET)).toBe(false);
  });

  it("rejects a tampered body (even a single byte, even re-serialised JSON)", () => {
    const sig = b64(BODY);
    expect(verifyWooWebhookSignature(BODY + " ", sig, SECRET)).toBe(false);
    expect(verifyWooWebhookSignature(BODY.replace("981", "982"), sig, SECRET)).toBe(false);
    // Same JSON value, different bytes: signature is over RAW bytes.
    expect(verifyWooWebhookSignature(JSON.stringify(JSON.parse(BODY), null, 2), sig, SECRET)).toBe(false);
  });

  it("fails closed on a missing or blank header or secret", () => {
    expect(verifyWooWebhookSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyWooWebhookSignature(BODY, "", SECRET)).toBe(false);
    expect(verifyWooWebhookSignature(BODY, "   ", SECRET)).toBe(false);
    expect(verifyWooWebhookSignature(BODY, b64(BODY), undefined)).toBe(false);
    expect(verifyWooWebhookSignature(BODY, b64(BODY), "")).toBe(false);
    expect(verifyWooWebhookSignature(BODY, b64(BODY), "   ")).toBe(false);
  });

  it("does not throw on a signature of a different length (timingSafeEqual would)", () => {
    expect(() => verifyWooWebhookSignature(BODY, "short", SECRET)).not.toThrow();
    expect(verifyWooWebhookSignature(BODY, "short", SECRET)).toBe(false);
    expect(verifyWooWebhookSignature(BODY, `${b64(BODY)}AAAA`, SECRET)).toBe(false);
    expect(verifyWooWebhookSignature(BODY, "é".repeat(44), SECRET)).toBe(false);
  });

  it("verifies non-ASCII bodies over their utf8 bytes", () => {
    const body = JSON.stringify({ id: 1, note: "caf\u00e9 \u2603" });
    expect(verifyWooWebhookSignature(body, b64(body), SECRET)).toBe(true);
  });
});

describe("isWooPingBody", () => {
  it.each(["webhook_id=42", "webhook_id=7\n", " webhook_id=1234 "])("detects the ping %j", (body) => {
    expect(isWooPingBody(body)).toBe(true);
  });

  it.each(["", "{}", BODY, "webhook_id=", "webhook_id=abc", "webhook_id=1&x=2", "id=5"])(
    "does not treat %j as a ping",
    (body) => {
      expect(isWooPingBody(body)).toBe(false);
    },
  );
});

describe("wooEventId / wooDeliveryKey / event name", () => {
  it("event id is deterministic: woo:order:<id>:paid", () => {
    expect(wooEventId({ id: 981 })).toBe("woo:order:981:paid");
    expect(wooEventId({ id: "981" })).toBe(wooEventId({ id: 981 }));
  });

  it("refuses an order without a usable id instead of inventing a key", () => {
    expect(() => wooEventId({ id: "" })).toThrow(/missing/);
    expect(() => wooEventId({ id: "unknown" })).toThrow(/missing/);
  });

  it("delivery key uses the delivery header, falling back to a body hash, never 'unknown'", () => {
    const withHeader = new Headers({ "X-WC-Webhook-Delivery-ID": "abc123" });
    expect(wooDeliveryKey(withHeader, BODY)).toBe("woo-delivery:abc123");
    const none = wooDeliveryKey(new Headers(), BODY);
    expect(none).toMatch(/^woo-body:[0-9a-f]{64}$/);
    expect(none).toBe(wooDeliveryKey(new Headers(), BODY)); // stable
    expect(none).not.toBe(wooDeliveryKey(new Headers(), BODY + "x"));
    expect(wooDeliveryKey(new Headers({ "x-wc-webhook-delivery-id": "  " }), BODY)).toMatch(/^woo-body:/);
    expect(none).not.toContain("unknown");
  });

  it("listens on the event name the registered function uses", () => {
    expect(WOO_ORDER_EVENT).toBe("woo.order.validated");
  });
});

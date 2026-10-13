import { describe, expect, it } from "vitest";
import {
  IDEMPOTENCY_BY_EVENT_ID,
  IDEMPOTENCY_BY_GLOBAL_SKU,
  QBO_REQUEST_ID_MAX_LENGTH,
  inngestEventId,
  katanaOrderNo,
  qboRequestId,
} from "@/server/sre/idempotency";
import { ghlFactoryOrderNo } from "@/server/ghl/hold-order";

describe("inngestEventId", () => {
  it("is deterministic and namespaced", () => {
    expect(inngestEventId("woo:order", "123")).toBe("woo:order:123");
    expect(inngestEventId("woo:order", 123)).toBe("woo:order:123");
    expect(inngestEventId("woo:order", "123")).toBe(inngestEventId("woo:order", "123"));
  });

  it("appends a discriminator when given", () => {
    expect(inngestEventId("woo:order", "123", "paid")).toBe("woo:order:123:paid");
    expect(inngestEventId("woo:order", "123", "paid")).not.toBe(inngestEventId("woo:order", "123"));
  });

  it("trims surrounding whitespace so retries cannot fork the key", () => {
    expect(inngestEventId("woo:order", "  123 ")).toBe("woo:order:123");
  });

  it.each(["", "   ", "\t\n", "unknown", "UNKNOWN", " Unknown "])(
    "rejects missing external id %j instead of falling back to unknown",
    (bad) => {
      expect(() => inngestEventId("woo:order", bad)).toThrow(/externalId is missing/);
    },
  );

  it("rejects an empty source or discriminator", () => {
    expect(() => inngestEventId("", "1")).toThrow(/source is missing/);
    expect(() => inngestEventId("woo:order", "1", "  ")).toThrow(/discriminator is missing/);
  });
});

describe("katanaOrderNo", () => {
  it("matches the existing GHL convention exactly", () => {
    expect(katanaOrderNo("ghl", "opp_42")).toBe(ghlFactoryOrderNo("opp_42"));
    expect(katanaOrderNo("ghl", "opp_42")).toBe("GHL-opp_42");
  });

  it("matches the existing Woo convention (WOO-<id>)", () => {
    expect(katanaOrderNo("woo", 981)).toBe("WOO-981");
    expect(katanaOrderNo("woocommerce", "981")).toBe("WOO-981");
  });

  it("rejects unknown sources and missing ids", () => {
    expect(() => katanaOrderNo("clover", "1")).toThrow(/unsupported source/);
    expect(() => katanaOrderNo("woo", "unknown")).toThrow(/externalId is missing/);
    expect(() => katanaOrderNo("ghl", "")).toThrow(/externalId is missing/);
  });
});

describe("qboRequestId", () => {
  it("is deterministic", () => {
    expect(qboRequestId("saga-1", "deposit")).toBe(qboRequestId("saga-1", "deposit"));
  });

  it("is at most 50 chars (the QBO limit) even for very long saga keys", () => {
    const long = "x".repeat(5000);
    expect(qboRequestId(long, "deposit").length).toBeLessThanOrEqual(QBO_REQUEST_ID_MAX_LENGTH);
    expect(qboRequestId("a", "b")).toMatch(/^[0-9a-f]{50}$/);
  });

  it("separates legs of the same saga and sagas of the same leg", () => {
    expect(qboRequestId("saga-1", "deposit")).not.toBe(qboRequestId("saga-1", "journal"));
    expect(qboRequestId("saga-1", "deposit")).not.toBe(qboRequestId("saga-2", "deposit"));
  });

  it("does not let (key, leg) boundaries collide", () => {
    expect(qboRequestId("ab", "c")).not.toBe(qboRequestId("a", "bc"));
  });

  it("rejects empty and unknown inputs", () => {
    expect(() => qboRequestId("", "leg")).toThrow(/sagaKey is missing/);
    expect(() => qboRequestId("saga", "  ")).toThrow(/leg is missing/);
    expect(() => qboRequestId("unknown", "leg")).toThrow(/sagaKey is missing/);
  });
});

describe("CEL idempotency constants", () => {
  it("are non-empty expression strings", () => {
    expect(IDEMPOTENCY_BY_EVENT_ID).toBe("event.id");
    expect(IDEMPOTENCY_BY_GLOBAL_SKU).toBe("event.data.globalSku");
  });
});

import { describe, expect, it } from "vitest";
import {
  flagSharedCanonical,
  flagSharedLegacy,
  normalizeLegacySku,
  normalizeProductUrl,
  sharedCanonicalPatches,
  sharedLegacyPatches,
} from "@/lib/ecommerce-roster";

describe("normalizeProductUrl", () => {
  it("trims and accepts http and https", () => {
    expect(normalizeProductUrl("  https://ccpatio.com/p/x  ")).toEqual({
      ok: true,
      value: "https://ccpatio.com/p/x",
    });
    expect(normalizeProductUrl("http://a.test/x").ok).toBe(true);
  });

  it("rejects blank, missing scheme, other schemes and garbage", () => {
    for (const bad of ["", "   ", null, undefined, "ccpatio.com/x", "ftp://a.test/x", "javascript:alert(1)", "not a url"]) {
      expect(normalizeProductUrl(bad as string | null | undefined).ok).toBe(false);
    }
  });

  it("does not invent a scheme", () => {
    const r = normalizeProductUrl("www.ccpatio.com");
    expect(r.ok).toBe(false);
  });

  it("enforces the 2000 character limit", () => {
    const base = "https://a.test/";
    expect(normalizeProductUrl(base + "x".repeat(2000 - base.length)).ok).toBe(true);
    expect(normalizeProductUrl(base + "x".repeat(2001 - base.length)).ok).toBe(false);
  });
});

describe("normalizeLegacySku", () => {
  it("trims and uppercases", () => {
    expect(normalizeLegacySku("  brv-sofa-72 ")).toEqual({ ok: true, value: "BRV-SOFA-72" });
  });

  it("rejects blank and out-of-range lengths", () => {
    expect(normalizeLegacySku("").ok).toBe(false);
    expect(normalizeLegacySku("A").ok).toBe(false);
    expect(normalizeLegacySku("AB").ok).toBe(true);
    expect(normalizeLegacySku("A".repeat(40)).ok).toBe(true);
    expect(normalizeLegacySku("A".repeat(41)).ok).toBe(false);
  });

  it("rejects characters outside A-Z 0-9 hyphen", () => {
    for (const bad of ["AB CD", "AB_CD", "AB.CD", "AB/CD", "ÄB-CD"]) {
      expect(normalizeLegacySku(bad).ok).toBe(false);
    }
  });

  it("rejects hub SKU prefixes in any case", () => {
    for (const bad of ["FIN-TJM-MIS", "asm-x-frame", "SA-X-CUSH", "rm-steel-1", "cut-abc"]) {
      const r = normalizeLegacySku(bad);
      expect(r.ok).toBe(false);
    }
    // Only a leading prefix is rejected.
    expect(normalizeLegacySku("BRV-FIN-1").ok).toBe(true);
    expect(normalizeLegacySku("FINAL-1").ok).toBe(true);
  });
});

describe("shared flag recomputation", () => {
  const items = [
    { id: "1", productName: "A", legacyBaseSku: "X1", legacySkuShared: true },
    { id: "2", productName: "B", legacyBaseSku: "X1", legacySkuShared: true },
    { id: "3", productName: "C", legacyBaseSku: null, legacySkuShared: false },
  ];

  it("flagSharedLegacy ignores null and counts case-insensitively", () => {
    const m = flagSharedLegacy([
      { productName: "A", legacyBaseSku: "x1" },
      { productName: "B", legacyBaseSku: "X1" },
      { productName: "C", legacyBaseSku: null },
    ]);
    expect(m.get("A")).toBe(true);
    expect(m.get("B")).toBe(true);
    expect(m.get("C")).toBe(false);
  });

  it("no patches when stored flags are already right", () => {
    expect(sharedLegacyPatches(items)).toEqual([]);
  });

  it("a new twin sets the chip on both rows", () => {
    const p = sharedLegacyPatches([
      { id: "1", productName: "A", legacyBaseSku: "X1", legacySkuShared: false },
      { id: "3", productName: "C", legacyBaseSku: "X1", legacySkuShared: false },
    ]);
    expect(p).toEqual([
      { id: "1", legacySkuShared: true },
      { id: "3", legacySkuShared: true },
    ]);
  });

  it("changing one twin clears the chip on the previous twin", () => {
    const p = sharedLegacyPatches([
      { id: "1", productName: "A", legacyBaseSku: "X1", legacySkuShared: true },
      { id: "2", productName: "B", legacyBaseSku: "X2", legacySkuShared: true },
    ]);
    expect(p).toEqual([
      { id: "1", legacySkuShared: false },
      { id: "2", legacySkuShared: false },
    ]);
  });

  it("canonical flags group by hub SKU and patch only changes", () => {
    const m = flagSharedCanonical([
      { productName: "A", globalSku: "FIN-1" },
      { productName: "B", globalSku: "fin-1" },
      { productName: "C", globalSku: "FIN-2" },
    ]);
    expect([m.get("A"), m.get("B"), m.get("C")]).toEqual([true, true, false]);

    const p = sharedCanonicalPatches([
      { id: "1", productName: "A", globalSku: "FIN-1", canonicalSkuShared: false },
      { id: "2", productName: "B", globalSku: "FIN-1", canonicalSkuShared: true },
      { id: "3", productName: "C", globalSku: "FIN-2", canonicalSkuShared: false },
    ]);
    expect(p).toEqual([{ id: "1", canonicalSkuShared: true }]);
  });
});

import { describe, expect, it } from "vitest";
import {
  findBestPriceMatch,
  normalizeExactKey,
  normalizeFuzzyKey,
  similarityPercent,
  auditMapToCsv,
  type PriceSheetRow,
} from "../scripts/audit-price-update";

describe("normalizeExactKey", () => {
  it("trims and lowercases", () => {
    expect(normalizeExactKey("  BRAVADA CLUB  ")).toBe("bravada club");
  });
});

describe("normalizeFuzzyKey", () => {
  it("collapses hyphen vs space variants", () => {
    expect(normalizeFuzzyKey("ONE-SIDED CHAISE")).toBe("one sided chaise");
    expect(normalizeFuzzyKey("ONE SIDED CHAISE")).toBe("one sided chaise");
  });
});

describe("similarityPercent", () => {
  it("scores identical strings 100", () => {
    expect(similarityPercent("abc", "abc")).toBe(100);
  });

  it("scores hyphen/space variants high after fuzzy normalize", () => {
    const a = normalizeFuzzyKey("ONE-SIDED");
    const b = normalizeFuzzyKey("ONE SIDED");
    expect(similarityPercent(a, b)).toBe(100);
  });
});

describe("findBestPriceMatch", () => {
  const priceRows: PriceSheetRow[] = [
    {
      memoDescription: "BRAVADA CLUB CHAIR 34\" x 34\" x 31\" BH",
      msrpOld: "2080",
      pricingIncrease100126: "2288",
    },
    {
      memoDescription: "OCEAN ONE SIDED CHAISE",
      msrpOld: "1000",
      pricingIncrease100126: "1100",
    },
  ];

  it("returns 100% on exact case-insensitive match", () => {
    const m = findBestPriceMatch('bravada club chair 34" x 34" x 31" bh', priceRows);
    expect(m.exact).toBe(true);
    expect(m.confidencePct).toBe(100);
    expect(m.row?.pricingIncrease100126).toBe("2288");
  });

  it("falls back to fuzzy for ONE-SIDED vs ONE SIDED", () => {
    const m = findBestPriceMatch("OCEAN ONE-SIDED CHAISE", priceRows);
    expect(m.exact).toBe(false);
    expect(m.confidencePct).toBeGreaterThanOrEqual(90);
    expect(m.row?.memoDescription).toBe("OCEAN ONE SIDED CHAISE");
  });
});

describe("auditMapToCsv", () => {
  it("emits Approved blank and required headers", () => {
    const csv = auditMapToCsv([
      {
        masterSku: "FIN-BRV-CLB-CHA-34X34",
        sparkProductName: 'BRAVADA CLUB CHAIR 34" x 34" x 31" BH',
        sparkCurrentPrice: "2080",
        foundPriceSheetName: 'BRAVADA CLUB CHAIR 34" x 34" x 31" BH',
        matchConfidencePct: 100,
        newProposedPrice1001: "2288",
        approved: "",
      },
    ]);
    expect(csv.split("\n")[0]).toBe(
      "Master SKU,Spark Product Name,Spark Current Price,Found Price Sheet Name,Match Confidence %,New Proposed Price (10/01),Approved",
    );
    expect(csv).toContain("FIN-BRV-CLB-CHA-34X34");
    expect(csv.trimEnd().endsWith(",")).toBe(true); // Approved blank trailing comma field
  });
});

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ getDb: vi.fn() }));

import { buildEstimatePdf } from "@/server/quotes/estimate-pdf";
import {
  PACKAGE_ISSUE_LABEL,
  pdfSafe,
  renderQuotePackage,
  specIssues,
  type SpecPageData,
} from "@/server/quotes/package-pdf";
import {
  HERO_HIGH_RES_MIN_EDGE,
  assembleSpec,
  assessReadiness,
  dimensionParts,
  distinctProductLines,
  imageTierFor,
  loadHeroes,
  prepareHero,
  type CatalogSource,
  type ListingSource,
  type SpecSources,
} from "@/server/quotes/package-specs";
import type { OrderDeskLine, OrderDeskQuote } from "@/server/quotes/view";

function line(partial: Partial<OrderDeskLine> & Pick<OrderDeskLine, "lineNo" | "sku">): OrderDeskLine {
  return {
    id: `line-${partial.lineNo}`,
    lineKind: "stock_hold",
    qty: "1.0000",
    unitPrice: "1000.00",
    priceError: null,
    description: partial.sku,
    holdId: null,
    ...partial,
  };
}

function quoteWith(lines: OrderDeskLine[]): OrderDeskQuote {
  return {
    state: "quote",
    readOnly: false,
    closedOpportunity: false,
    quoteId: "abcdef12-3456-7890-abcd-ef1234567890",
    version: 3,
    status: "draft",
    opportunityId: "opp-1",
    opportunityName: "Opp",
    customerName: "Jane Hotelier",
    customerEmail: "jane@example.com",
    billToAddress: "1 Main St",
    shipToAddress: "2 Pool Rd",
    discountAmount: "0",
    discountType: "FLAT",
    taxAmount: "0",
    selectedCarrierCode: null,
    destZip: "90005",
    distanceMiles: null,
    distanceSource: null,
    merchandiseTotal: null,
    freightMethod: null,
    freightTotal: "250.00",
    freightError: null,
    freightOptions: [],
    executedBy: "2026-10-15",
    promiseDate: null,
    calculatedPromiseDate: null,
    promiseTruckCode: null,
    promiseError: null,
    ghlSyncError: null,
    voidReason: null,
    lines,
    suggestions: [],
  } as OrderDeskQuote;
}

function catalog(partial: Partial<CatalogSource> = {}): CatalogSource {
  return {
    global_sku: "SOFA-1",
    msrp: "1000",
    length: "84",
    depth: "36",
    height: "30",
    arm_height: null,
    sit_height: '17"',
    description: null,
    na_fields: [],
    warranty_term_months: 24,
    ...partial,
  } as CatalogSource;
}

function listing(partial: Partial<ListingSource> = {}): ListingSource {
  return {
    global_sku: "SOFA-1",
    product_name: "Marlow Sofa",
    collection_label: "Marlow",
    marketing_description: "<p>Hand welded <strong>aluminum</strong> frame.</p>",
    archived_at: null,
    ...partial,
  };
}

async function png(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: "#336699" } })
      .png()
      .toBuffer(),
  );
}

function rawText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

afterEach(() => vi.restoreAllMocks());

describe("which products get a page", () => {
  it("one entry per distinct stock SKU, quantities summed, custom lines skipped", () => {
    const lines = [
      line({ lineNo: 2, sku: "chair-1", qty: "2.0000", unitPrice: null }),
      line({ lineNo: 1, sku: "SOFA-1", qty: "1.0000" }),
      line({ lineNo: 3, sku: "CHAIR-1", qty: "1.0000", unitPrice: "300.00" }),
      line({ lineNo: 4, sku: "CUSTOM-X", lineKind: "custom" }),
      line({ lineNo: 5, sku: "  ", qty: "1" }),
    ];
    expect(distinctProductLines(lines)).toEqual([
      { sku: "SOFA-1", qty: "1.0000", unitPrice: "1000.00", description: "SOFA-1" },
      { sku: "CHAIR-1", qty: "3", unitPrice: "300.00", description: "chair-1" },
    ]);
  });

  it("steps image quality down as the package grows", () => {
    expect(imageTierFor(1).maxEdge).toBe(1600);
    expect(imageTierFor(4).maxEdge).toBe(1600);
    expect(imageTierFor(5).maxEdge).toBe(1200);
    expect(imageTierFor(10).maxEdge).toBe(1200);
    expect(imageTierFor(11).maxEdge).toBe(900);
    expect(imageTierFor(11).quality).toBeLessThan(imageTierFor(1).quality);
  });
});

describe("page content from catalog rows", () => {
  it("formats dimensions, honours Not Applicable, and adds the inch mark once", () => {
    expect(dimensionParts(catalog())).toEqual([
      'Length  84"',
      'Depth  36"',
      'Height  30"',
      'Seat  17"',
    ]);
    expect(dimensionParts(catalog({ na_fields: ["depth", "sit_height"] }))).toEqual([
      'Length  84"',
      'Height  30"',
    ]);
    expect(dimensionParts(undefined)).toEqual([]);
  });

  it("builds a complete page from a healthy product", () => {
    const sources = { catalog: new Map([["SOFA-1", catalog()]]), listing: new Map([["SOFA-1", listing()]]) };
    const { page, issues } = assembleSpec(
      { sku: "SOFA-1", qty: "2", unitPrice: "1000.00", description: "x" },
      sources,
      { state: "ok", hero: { jpegBase64: "AA", width: 10, height: 10 } },
    );
    expect(issues).toEqual([]);
    expect(page).toMatchObject({
      productName: "Marlow Sofa",
      collectionLabel: "Marlow",
      warrantyMonths: 24,
    });
    expect(page.description).toBe("Hand welded aluminum frame.");
    expect(page.hero).not.toBeNull();
  });

  it("still builds a page for a product with bad data and lists every gap", () => {
    const empty = { catalog: new Map<string, CatalogSource>(), listing: new Map<string, ListingSource>() };
    const { page, issues } = assembleSpec(
      { sku: "GHOST-1", qty: "1", unitPrice: null, description: "Ghost chair" },
      empty,
      { state: "none" },
    );
    expect(page.productName).toBe("Ghost chair");
    expect(page.hero).toBeNull();
    expect(issues).toEqual([
      "missing_catalog_row",
      "missing_image",
      "missing_copy",
      "missing_dimensions",
      "missing_price",
    ]);
    for (const issue of issues) expect(PACKAGE_ISSUE_LABEL[issue]).toBeTruthy();
  });

  it("falls back from listing copy to the catalog description, and prefers a live listing", () => {
    const sources = {
      catalog: new Map([["SOFA-1", catalog({ description: "Catalog copy" })]]),
      listing: new Map([["SOFA-1", listing({ marketing_description: null })]]),
    };
    const { page } = assembleSpec({ sku: "SOFA-1", qty: "1", unitPrice: "1", description: "" }, sources, {
      state: "none",
    });
    expect(page.description).toBe("Catalog copy");
  });

  it("flags a low-resolution or unreadable hero distinctly", () => {
    const page = assembleSpec(
      { sku: "SOFA-1", qty: "1", unitPrice: "1", description: "" },
      { catalog: new Map([["SOFA-1", catalog()]]), listing: new Map([["SOFA-1", listing()]]) },
      { state: "low", hero: { jpegBase64: "AA", width: 1, height: 1 } },
    );
    expect(page.issues).toEqual(["low_resolution_image"]);
    expect(
      specIssues(page.page, { catalogRow: true, imageState: "unreadable" }),
    ).toEqual(["image_unreadable"]);
  });

  it("readiness is judged from rows only (a hero row counts as present)", () => {
    const sources: SpecSources = {
      catalog: new Map([["SOFA-1", catalog()]]),
      listing: new Map([["SOFA-1", listing()]]),
      heroPath: new Map([["SOFA-1", "sofa/hero.jpg"]]),
    };
    const entries = assessReadiness(
      [
        { sku: "SOFA-1", qty: "1", unitPrice: "1", description: "" },
        { sku: "GHOST-1", qty: "1", unitPrice: null, description: "Ghost" },
      ],
      sources,
    );
    expect(entries[0]).toMatchObject({ sku: "SOFA-1", issues: [] });
    expect(entries[1]!.issues).toContain("missing_catalog_row");
    expect(entries[1]!.issueLabels).toContain("No hero image");
  });
});

describe("hero images", () => {
  it("fits inside the tier box, never enlarges, and returns JPEG", async () => {
    const big = await prepareHero(await png(3000, 2000), { maxEdge: 1600, quality: 82 });
    expect(Math.max(big.hero.width, big.hero.height)).toBe(1600);
    expect(big.sourceLongEdge).toBe(3000);
    const small = await prepareHero(await png(800, 600), { maxEdge: 1600, quality: 82 });
    expect(small.hero.width).toBe(800);
    expect(Buffer.from(small.hero.jpegBase64, "base64").subarray(0, 3).toString("hex")).toBe("ffd8ff");
  });

  it("loads each SKU independently: ok, low-res, missing, and unreadable never fail the batch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const files: Record<string, () => Promise<Uint8Array>> = {
      "ok.png": () => png(2000, 1500),
      "low.png": () => png(900, 600),
      "broken.png": async () => new Uint8Array([1, 2, 3]),
      "gone.png": async () => {
        throw new Error("storage 404 secret=abc");
      },
    };
    const download = vi.fn(async (_bucket: string, path: string) => ({ bytes: await files[path]!() }));
    const result = await loadHeroes(
      ["OK", "LOW", "NONE", "BROKEN", "GONE"],
      new Map([
        ["OK", "ok.png"],
        ["LOW", "low.png"],
        ["BROKEN", "broken.png"],
        ["GONE", "gone.png"],
      ]),
      { maxEdge: 1200, quality: 78 },
      download,
    );
    expect(result.get("OK")?.state).toBe("ok");
    expect(result.get("LOW")?.state).toBe("low");
    expect(result.get("NONE")?.state).toBe("none");
    expect(result.get("BROKEN")?.state).toBe("unreadable");
    expect(result.get("GONE")?.state).toBe("unreadable");
    expect(download).toHaveBeenCalledTimes(4);
    expect(HERO_HIGH_RES_MIN_EDGE).toBe(1200);
  });

  it("logs a failed hero without the provider message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadHeroes(["GONE"], new Map([["GONE", "gone.png"]]), { maxEdge: 900, quality: 72 }, async () => {
      throw new Error("storage 404 secret=abc");
    });
    const raw = String(spy.mock.calls[0]![0]);
    expect(raw).not.toContain("secret=abc");
    expect(JSON.parse(raw)).toMatchObject({ tag: "quote-package-hero-failed", sku: "GONE" });
  });
});

describe("single-document package", () => {
  const healthy: SpecPageData = {
    sku: "SOFA-1",
    productName: "Marlow Sofa",
    collectionLabel: "Marlow",
    qty: "2.0000",
    unitPrice: "1000.00",
    description: "Hand welded aluminum frame.",
    dimensions: ['Length  84"'],
    warrantyMonths: 24,
    hero: null,
  };

  it("is ONE PDF: estimate pages first, then exactly one page per product", async () => {
    const hero = await prepareHero(await png(1800, 1200), { maxEdge: 1600, quality: 82 });
    const quote = quoteWith([line({ lineNo: 1, sku: "SOFA-1" }), line({ lineNo: 2, sku: "CHAIR-1" })]);
    const result = renderQuotePackage(
      quote,
      [
        { ...healthy, hero: hero.hero },
        { ...healthy, sku: "CHAIR-1", productName: "Marlow Chair", hero: null },
      ],
      { compress: false },
    );

    expect(result.estimatePages).toBeGreaterThanOrEqual(1);
    expect(result.specPages).toBe(2);
    expect(result.pageCount).toBe(result.estimatePages + 2);

    const text = rawText(result.bytes);
    expect(text.startsWith("%PDF-")).toBe(true);
    expect((text.match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBe(result.pageCount);
    expect(text).toContain(`Page ${result.pageCount} of ${result.pageCount}`);
    expect(text).toContain("Page 1 of");
    expect(text).toContain("Quote ABCDEF12");
    // Estimate numbers and policy footer are present...
    expect(text).toContain("Subtotal");
    expect(text).toContain("Order & Payment Policies");
    // ...followed by the specification content.
    expect(text).toContain("Marlow Sofa");
    expect(text).toContain("Marlow Chair");
    expect(text).toContain("Product photography available on request"); // chair has no hero
    expect(text.indexOf("Subtotal")).toBeLessThan(text.indexOf("Marlow Sofa"));
  });

  it("carries document properties and a bookmark per product", () => {
    const result = renderQuotePackage(quoteWith([line({ lineNo: 1, sku: "SOFA-1" })]), [healthy], {
      compress: false,
    });
    const text = rawText(result.bytes);
    expect(text).toContain("/Title (CC Patio Quote Package - Jane Hotelier)");
    expect(text).toContain("/Author (CC Patio)");
    expect(text).toContain("/Outlines");
    expect(text).toContain("(Estimate)");
    expect(text).toContain("(Marlow Sofa \\(SOFA-1\\))");
  });

  it("shows the QUOTED price, never list MSRP, and 'Price on request' when unpriced", () => {
    const priced = rawText(renderQuotePackage(quoteWith([]), [healthy], { compress: false }).bytes);
    expect(priced).toContain("$1,000.00 each");
    expect(priced).toContain("$2,000.00");
    const unpriced = rawText(
      renderQuotePackage(quoteWith([]), [{ ...healthy, unitPrice: null }], { compress: false }).bytes,
    );
    expect(unpriced).toContain("Price on request");
  });

  it("with no products it is just the estimate", () => {
    const result = renderQuotePackage(quoteWith([]), []);
    expect(result.specPages).toBe(0);
    expect(result.pageCount).toBe(result.estimatePages);
  });

  it("keeps the standalone estimate working and prints the same estimate pages", () => {
    const quote = quoteWith([line({ lineNo: 1, sku: "SOFA-1" })]);
    const alone = buildEstimatePdf(quote);
    expect(Buffer.from(alone).subarray(0, 5).toString()).toBe("%PDF-");
    const pkg = renderQuotePackage(quote, []);
    expect(pkg.estimatePages).toBeGreaterThanOrEqual(1);
  });

  it("strips characters the built-in PDF fonts cannot print", () => {
    expect(pdfSafe("Caf\u00e9 \u2014 \u2018quoted\u2019 \u4e2d\u6587 \u{1F600}")).toBe(
      "Caf\u00e9 \u2014 \u2018quoted\u2019  ",
    );
  });

  it("stays small: a 12-product package of 2400px heroes is well under 12 MB", async () => {
    const tier = imageTierFor(12);
    const hero = await prepareHero(await png(2400, 1600), tier);
    const specs = Array.from({ length: 12 }, (_, index) => ({
      ...healthy,
      sku: `SKU-${index}`,
      productName: `Product ${index}`,
      hero: hero.hero,
    }));
    const result = renderQuotePackage(quoteWith([]), specs);
    expect(result.pageCount).toBe(result.estimatePages + 12);
    expect(result.bytes.byteLength).toBeLessThan(12 * 1024 * 1024);
  });
});

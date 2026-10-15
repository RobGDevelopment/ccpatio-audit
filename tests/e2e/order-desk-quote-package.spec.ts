/**
 * Order Desk quote package, in a real browser.
 *
 * Seeds a walk-in draft with two stock lines (one complete product with a real hero image in Supabase
 * Storage, one bare product), opens `/embed/order-desk?quoteId=...` with the e2e god-mode session, and proves:
 *   - the draft, the invoice summary and the per-product package readiness render
 *   - "Download Quote Package" triggers a real browser download of a valid multi-page PDF that names both
 *     products, and the notice names the product that printed with gaps
 *   - "Estimate only" downloads a shorter PDF
 *   - generating a document never changes the quote's status or its merchandise total
 *   - a missing quote and a missing access key render their error states
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { injectGodModeSession } from "./helpers/god-mode-auth";
import {
  cleanupQuotePackage,
  closePhase13Db,
  newRunToken,
  readQuoteState,
  seedQuotePackage,
  type PackageSeed,
} from "./helpers/phase13-seed";

const run = newRunToken();

/** Every stream's text, inflated when it is Flate-compressed. jsPDF may or may not compress. */
function pdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const parts: string[] = [raw];
  const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
    try {
      parts.push(inflateSync(Buffer.from(match[1]!, "latin1")).toString("latin1"));
    } catch (error) {
      // Not Flate data (an image or an uncompressed stream). Its raw bytes are already in parts[0].
      void error;
    }
  }
  return parts.join("\n");
}

function pageCount(bytes: Buffer): number {
  return (bytes.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

test.describe.configure({ mode: "serial" });

test.describe("Order Desk quote package (signed in)", () => {
  test.setTimeout(180_000);

  let seed: PackageSeed;
  let packagePages = 0;

  test.beforeAll(async () => {
    seed = await seedQuotePackage(run);
  });

  test.afterAll(async () => {
    try {
      await cleanupQuotePackage(run);
    } finally {
      await closePhase13Db();
    }
  });

  test.beforeEach(async ({ context }) => {
    await injectGodModeSession(context);
  });

  test("opens the draft, shows the invoice maths and per-product package readiness", async ({ page }) => {
    await page.goto(`/embed/order-desk?quoteId=${seed.quoteId}`);

    await expect(page.getByTestId("order-desk-draft")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId("order-desk-status")).toHaveText(/draft/i);
    const lines = page.getByTestId("order-desk-lines");
    await expect(lines).toContainText(seed.readySku);
    await expect(lines).toContainText("Qty 2");
    await expect(lines).toContainText(seed.gapSku);

    // 2 x 2450 + 1 x 1000 = 5900, plus 250 freight, no discount, no tax.
    await expect(page.getByTestId("order-desk-subtotal")).toHaveText("$5,900.00");
    await expect(page.getByTestId("order-desk-shipping")).toHaveText("$250.00");
    await expect(page.getByTestId("order-desk-grand-total")).toHaveText("$6,150.00");

    const ready = page.getByTestId(`order-desk-package-readiness-${seed.readySku}`);
    await expect(ready).toContainText("page ready", { timeout: 60_000 });
    const gap = page.getByTestId(`order-desk-package-readiness-${seed.gapSku}`);
    await expect(gap).toContainText("prints with a gap");
    for (const issue of ["No catalog record", "No hero image", "No marketing copy", "No dimensions"]) {
      await expect(gap).toContainText(issue);
    }
    await expect(page.getByTestId("order-desk-download-pdf")).toHaveText("Download Quote Package");
  });

  test("Download Quote Package delivers a valid multi-page PDF and names the product with gaps", async ({ page }) => {
    await page.goto(`/embed/order-desk?quoteId=${seed.quoteId}`);
    await expect(page.getByTestId("order-desk-draft")).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId(`order-desk-package-readiness-${seed.readySku}`)).toBeVisible({ timeout: 60_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 120_000 }),
      page.getByTestId("order-desk-download-pdf").click(),
    ]);

    expect(download.suggestedFilename()).toBe(`CCPatio-Quote-QA-Package-Customer-${run}.pdf`);
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.subarray(-32).toString("latin1")).toContain("%%EOF");
    expect(bytes.byteLength).toBeGreaterThan(8_000);

    // Estimate (at least one page) plus one specification page per distinct product.
    packagePages = pageCount(bytes);
    expect(packagePages).toBeGreaterThanOrEqual(3);

    const text = pdfText(bytes);
    expect(text).toContain(seed.readySku);
    expect(text).toContain(seed.gapSku);
    expect(text).toContain(seed.customerName);

    // The page reports exactly one degraded product, and it is the bare one.
    const notice = page.getByTestId("order-desk-notice");
    await expect(notice).toContainText("Quote package downloaded with 1 product page missing data");
    await expect(notice).toContainText(seed.gapSku);
    await expect(notice).toContainText("No catalog record");
    await expect(notice).not.toContainText(seed.readySku);
    await expect(page.getByTestId("order-desk-download-pdf")).toHaveText("Download Quote Package");
    await expect(page.getByTestId("order-desk-download-pdf")).toBeEnabled();
  });

  test("Estimate only downloads a shorter PDF", async ({ page }) => {
    expect(packagePages, "the package test must run first").toBeGreaterThanOrEqual(3);
    await page.goto(`/embed/order-desk?quoteId=${seed.quoteId}`);
    await expect(page.getByTestId("order-desk-draft")).toBeVisible({ timeout: 90_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 120_000 }),
      page.getByTestId("order-desk-download-estimate").click(),
    ]);

    expect(download.suggestedFilename()).toBe(`CCPatio-Estimate-QA-Package-Customer-${run}.pdf`);
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pageCount(bytes)).toBeGreaterThanOrEqual(1);
    expect(pageCount(bytes)).toBeLessThan(packagePages);
    // The estimate lists line descriptions (the SKU printed on the spec pages is package-only).
    const text = pdfText(bytes);
    expect(text).toContain("QA Package Lounge Complete");
    expect(text).toContain("QA Package Lounge Bare");
    expect(text).toContain(seed.customerName);
  });

  test("generating documents leaves the quote a draft with the same merchandise total", async () => {
    const quote = await readQuoteState(seed.quoteId);
    expect(quote).toMatchObject({
      status: "draft",
      merchandise_total: "5900.00",
      freight_total: "250.00",
      customer_name: seed.customerName,
    });
  });

  test("a quote that does not exist renders the not-found state", async ({ page }) => {
    await page.goto("/embed/order-desk?quoteId=00000000-0000-4000-8000-000000000000");
    await expect(page.getByTestId("order-desk-error")).toContainText("That quote could not be found.", {
      timeout: 90_000,
    });
    await expect(page.getByTestId("order-desk-download-pdf")).toHaveCount(0);
  });
});

test.describe("Order Desk quote package (no session)", () => {
  test("an embed link with no access key shows the unauthorized alert and no quote data", async ({ page }) => {
    await page.goto("/embed/order-desk?quoteId=00000000-0000-4000-8000-000000000000");
    await expect(page.getByTestId("order-desk-unauthorized")).toContainText("missing a valid access key", {
      timeout: 90_000,
    });
    await expect(page.getByTestId("order-desk-draft")).toHaveCount(0);
    await expect(page.getByTestId("order-desk-download-pdf")).toHaveCount(0);
  });
});

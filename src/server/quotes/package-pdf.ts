/**
 * Institutional Quote Package renderer (pure: no database, no network).
 *
 * ONE jsPDF document, in this order:
 *   1. the itemised estimate (the same pages `buildEstimatePdf` produces)
 *   2. one specification page per distinct product on the quote: hero image, quoted price,
 *      dimensions, marketing copy, warranty
 * Every page carries "Quote XXXXXXXX · Page i of N". The file has document properties
 * (title, subject, author, keywords) and a bookmark outline (Estimate, then one bookmark per
 * product), so it navigates well in a mail client preview and prints cleanly on letter paper.
 *
 * A product with bad data still gets its page. A missing hero becomes a labelled placeholder,
 * missing copy or dimensions are simply left out, and the gaps are reported back through
 * {@link PackageIssue} so the operator can fix them. A single bad record never stalls a quote.
 */
import { jsPDF } from "jspdf";
import { renderEstimate } from "@/server/quotes/estimate-pdf";
import type { OrderDeskQuote } from "@/server/quotes/view";

export type PackageIssue =
  | "missing_catalog_row"
  | "missing_image"
  | "low_resolution_image"
  | "image_unreadable"
  | "missing_copy"
  | "missing_dimensions"
  | "missing_price";

export const PACKAGE_ISSUE_LABEL: Record<PackageIssue, string> = {
  missing_catalog_row: "No catalog record",
  missing_image: "No hero image",
  low_resolution_image: "Hero image under 1200 px",
  image_unreadable: "Hero image could not be read",
  missing_copy: "No marketing copy",
  missing_dimensions: "No dimensions",
  missing_price: "No price",
};

export type SpecHero = {
  /** Base64 JPEG without the data-URI prefix. */
  jpegBase64: string;
  width: number;
  height: number;
};

export type SpecPageData = {
  sku: string;
  productName: string;
  collectionLabel: string | null;
  /** Total quantity of this SKU on the quote, as stored. */
  qty: string;
  unitPrice: string | null;
  /** Plain text, already stripped of HTML. */
  description: string | null;
  dimensions: string[];
  warrantyMonths: number | null;
  hero: SpecHero | null;
};

export type PackageResult = {
  bytes: Uint8Array;
  pageCount: number;
  estimatePages: number;
  specPages: number;
};

const NAVY: [number, number, number] = [15, 23, 42];
const GOLD: [number, number, number] = [197, 160, 89];
const SLATE: [number, number, number] = [100, 116, 139];
const INK: [number, number, number] = [51, 65, 85];

/**
 * jsPDF's built-in fonts are WinAnsi only. Anything outside that set would print as
 * garbage, so it is replaced rather than passed through.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u2010\u2011\u2012]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[^\u0009\u000A\u0020-\u007E\u00A1-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC\u2122]/g, "");
}

function money(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function quantityText(qty: string): string {
  const value = Number(qty);
  if (!Number.isFinite(value)) return qty;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

/** Which gaps this product has, judged from the data about to be printed. */
export function specIssues(data: SpecPageData, options: { catalogRow: boolean; imageState: "ok" | "none" | "low" | "unreadable" }): PackageIssue[] {
  const issues: PackageIssue[] = [];
  if (!options.catalogRow) issues.push("missing_catalog_row");
  if (options.imageState === "none") issues.push("missing_image");
  if (options.imageState === "low") issues.push("low_resolution_image");
  if (options.imageState === "unreadable") issues.push("image_unreadable");
  if (!data.description) issues.push("missing_copy");
  if (data.dimensions.length === 0) issues.push("missing_dimensions");
  if (data.unitPrice == null || !Number.isFinite(Number(data.unitPrice))) issues.push("missing_price");
  return issues;
}

function drawSpecPage(doc: jsPDF, data: SpecPageData): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentWidth = pageWidth - margin * 2;

  // Header band with a gold hairline.
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 34, "F");
  doc.setFillColor(...GOLD);
  doc.rect(0, 34, pageWidth, 1.5, "F");
  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text("CC PATIO", margin, 22);
  doc.text("PRODUCT SPECIFICATION", pageWidth - margin, 22, { align: "right" });

  // Hero.
  let y = 54;
  const heroMaxHeight = 300;
  if (data.hero && data.hero.width > 0 && data.hero.height > 0) {
    let renderWidth = contentWidth;
    let renderHeight = renderWidth * (data.hero.height / data.hero.width);
    if (renderHeight > heroMaxHeight) {
      renderHeight = heroMaxHeight;
      renderWidth = renderHeight * (data.hero.width / data.hero.height);
    }
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, contentWidth, renderHeight, "F");
    doc.addImage(
      data.hero.jpegBase64,
      "JPEG",
      margin + (contentWidth - renderWidth) / 2,
      y,
      renderWidth,
      renderHeight,
      undefined,
      "FAST",
    );
    y += renderHeight + 18;
  } else {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, y, contentWidth, heroMaxHeight, "FD");
    doc.setFont("times", "italic");
    doc.setFontSize(12);
    doc.setTextColor(...SLATE);
    doc.text("Product photography available on request", pageWidth / 2, y + heroMaxHeight / 2, {
      align: "center",
    });
    y += heroMaxHeight + 18;
  }

  // Title block.
  if (data.collectionLabel) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GOLD);
    doc.text(pdfSafe(data.collectionLabel).toUpperCase(), margin, y);
    y += 14;
  }
  doc.setFont("times", "bold");
  doc.setFontSize(22);
  doc.setTextColor(...NAVY);
  const nameLines = (doc.splitTextToSize(pdfSafe(data.productName), contentWidth) as string[]).slice(0, 2);
  doc.text(nameLines, margin, y);
  y += nameLines.length * 24;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...SLATE);
  doc.text(pdfSafe(data.sku), margin, y);
  y += 20;

  // Quoted price for THIS quote (never list MSRP, so the page cannot contradict the estimate).
  const unit = data.unitPrice != null && Number.isFinite(Number(data.unitPrice)) ? Number(data.unitPrice) : null;
  const qty = Number(data.qty);
  doc.setFont("times", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...NAVY);
  if (unit != null) {
    const extended = Number.isFinite(qty) ? unit * qty : null;
    const parts = [`${money(unit)} each`, `Qty ${quantityText(data.qty)}`];
    if (extended != null) parts.push(money(extended));
    doc.text(parts.join("   ·   "), margin, y);
  } else {
    doc.text(`Price on request   ·   Qty ${quantityText(data.qty)}`, margin, y);
  }
  y += 10;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 16;

  if (data.dimensions.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    doc.text("DIMENSIONS", margin, y);
    y += 13;
    doc.setFont("times", "normal");
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(pdfSafe(data.dimensions.join("      ")), contentWidth) as string[];
    doc.text(lines, margin, y);
    y += lines.length * 14 + 10;
  }

  // Footer text is measured first so the copy block never collides with it.
  const footerText =
    data.warrantyMonths != null
      ? `Finish and fabric shown are representative. Specification is confirmed at order. Warranty: ${data.warrantyMonths} months.`
      : "Finish and fabric shown are representative. Specification is confirmed at order.";
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  const footerLines = doc.splitTextToSize(footerText, contentWidth) as string[];
  const footerTop = pageHeight - 44 - footerLines.length * 10;

  if (data.description) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...SLATE);
    doc.text("ABOUT THIS PIECE", margin, y);
    y += 13;
    doc.setFont("times", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    const copyLines = doc.splitTextToSize(pdfSafe(data.description), contentWidth) as string[];
    const lineHeight = 14;
    const room = Math.max(1, Math.floor((footerTop - 10 - y) / lineHeight));
    const visible = copyLines.slice(0, room);
    if (copyLines.length > room && visible.length > 0) {
      const last = visible[visible.length - 1]!;
      visible[visible.length - 1] = last.length > 3 ? `${last.slice(0, -1).trimEnd()}…` : "…";
    }
    doc.text(visible, margin, y);
  }

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(footerLines, margin, footerTop);
}

function packageTitle(quote: OrderDeskQuote): string {
  const who = quote.customerName?.trim() || quote.opportunityName?.trim() || "Customer";
  return pdfSafe(`CC Patio Quote Package - ${who}`);
}

/** `compress: false` is for tests that read page text out of the raw bytes. */
export function renderQuotePackage(
  quote: OrderDeskQuote,
  specs: readonly SpecPageData[],
  options: { compress?: boolean } = {},
): PackageResult {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: options.compress ?? true });
  renderEstimate(doc, quote, { title: "Quote Package · Estimate" });
  const estimatePages = doc.getNumberOfPages();

  const firstSpecPage = new Map<string, number>();
  for (const spec of specs) {
    doc.addPage();
    firstSpecPage.set(spec.sku, doc.getNumberOfPages());
    drawSpecPage(doc, spec);
  }

  const pageCount = doc.getNumberOfPages();
  const reference = `Quote ${quote.quoteId.slice(0, 8).toUpperCase()}`;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`CC Patio  ·  ${reference}  ·  Page ${page} of ${pageCount}`, pageWidth / 2, pageHeight - 22, {
      align: "center",
    });
  }

  doc.setProperties({
    title: packageTitle(quote),
    subject: `Estimate and product specifications for ${reference}`,
    author: "CC Patio",
    creator: "CC Patio Order Desk",
    keywords: ["quote", reference, ...specs.map((spec) => spec.sku)].join(", "),
  });

  doc.outline.add(null, "Estimate", { pageNumber: 1 });
  for (const spec of specs) {
    doc.outline.add(null, pdfSafe(`${spec.productName} (${spec.sku})`), {
      pageNumber: firstSpecPage.get(spec.sku) ?? 1,
    });
  }

  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    pageCount,
    estimatePages,
    specPages: specs.length,
  };
}

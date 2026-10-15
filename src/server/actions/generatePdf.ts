"use server";

import { logError } from "@/lib/log/structured";
import { getPimSession } from "@/lib/pim-audit";
import { loadQuoteDocumentById } from "@/server/quotes/draft";
import { buildEstimatePdf } from "@/server/quotes/estimate-pdf";
import {
  buildQuotePackage,
  readQuotePackageReadiness,
  type QuotePackageReport,
  type ReadinessEntry,
} from "@/server/quotes/package-specs";

function slugFor(quote: { customerName: string | null; opportunityName: string | null }): string {
  return (
    (quote.customerName ?? quote.opportunityName ?? "estimate")
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "estimate"
  );
}

export async function generateQuotePdf(
  quoteId: string,
): Promise<
  | { ok: true; filename: string; contentType: "application/pdf"; pdfBase64: string }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to download this estimate." };

  const id = quoteId.trim();
  if (!id) return { ok: false, error: "That quote could not be found." };

  const quote = await loadQuoteDocumentById(id);
  if (!quote) return { ok: false, error: "That quote could not be found." };

  const pdf = buildEstimatePdf(quote);
  return {
    ok: true,
    filename: `CCPatio-Estimate-${slugFor(quote)}.pdf`,
    contentType: "application/pdf",
    pdfBase64: Buffer.from(pdf).toString("base64"),
  };
}

/**
 * The Institutional Quote Package: the itemised estimate followed by a specification page
 * for every product on the quote, as one PDF. Read-only. It never writes to QuickBooks and
 * never changes the quote.
 */
export async function generateQuotePackage(
  quoteId: string,
): Promise<
  | {
      ok: true;
      filename: string;
      contentType: "application/pdf";
      pdfBase64: string;
      report: QuotePackageReport;
    }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to download this quote package." };

  const id = quoteId.trim();
  if (!id) return { ok: false, error: "That quote could not be found." };

  try {
    const quote = await loadQuoteDocumentById(id);
    if (!quote) return { ok: false, error: "That quote could not be found." };

    const { bytes, report } = await buildQuotePackage(quote);
    return {
      ok: true,
      filename: `CCPatio-Quote-${slugFor(quote)}.pdf`,
      contentType: "application/pdf",
      pdfBase64: Buffer.from(bytes).toString("base64"),
      report,
    };
  } catch (error) {
    const ref = logError("quote-package-failed", error, { quoteId: id });
    return { ok: false, error: `The quote package could not be built. Reference ${ref}.` };
  }
}

/** Per-product readiness for the package, judged from catalog rows only (no image download). */
export async function getQuotePackageReadiness(
  quoteId: string,
): Promise<{ ok: true; entries: ReadinessEntry[] } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to check this quote package." };

  const id = quoteId.trim();
  if (!id) return { ok: false, error: "That quote could not be found." };

  try {
    const quote = await loadQuoteDocumentById(id);
    if (!quote) return { ok: false, error: "That quote could not be found." };
    return { ok: true, entries: await readQuotePackageReadiness(quote) };
  } catch (error) {
    const ref = logError("quote-package-readiness-failed", error, { quoteId: id });
    return { ok: false, error: `Readiness could not be checked. Reference ${ref}.` };
  }
}

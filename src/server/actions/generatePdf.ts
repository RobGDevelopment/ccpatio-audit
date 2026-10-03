"use server";

import { getPimSession } from "@/lib/pim-audit";
import { loadQuoteDocumentById } from "@/server/quotes/draft";
import { buildEstimatePdf } from "@/server/quotes/estimate-pdf";

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
  const slug =
    (quote.customerName ?? quote.opportunityName ?? "estimate")
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "estimate";

  return {
    ok: true,
    filename: `CCPatio-Estimate-${slug}.pdf`,
    contentType: "application/pdf",
    pdfBase64: Buffer.from(pdf).toString("base64"),
  };
}

import { and, eq, sql } from "drizzle-orm";
import { merchandiseTotal } from "@/server/quotes/msrp";
import { getDb } from "@/server/db/client";
import { quote_line_items, quotes } from "@/server/db/schema";
import type { OrderDeskLine } from "@/server/quotes/view";

const CUSTOM_SKU = "CUSTOM";

class StaleQuoteError extends Error {
  constructor() {
    super("stale_version");
    this.name = "StaleQuoteError";
  }
}

export type AddCustomLineResult =
  | {
      ok: true;
      version: number;
      merchandiseTotal: string | null;
      line: OrderDeskLine;
    }
  | { ok: false; error: string };

/**
 * Manual description and price. No catalog lookup and no Katana variant.
 */
export async function addCustomQuoteLine(input: {
  quoteId: string;
  expectedVersion: number;
  description: string;
  unitPrice: number;
}): Promise<AddCustomLineResult> {
  const description = input.description.replace(/\s+/g, " ").trim();
  if (!description) return { ok: false, error: "Enter a description." };
  if (description.length > 500) {
    return { ok: false, error: "Description must be 500 characters or less." };
  }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    return { ok: false, error: "Enter a price of zero or more." };
  }
  const unitPrice = (Math.round((input.unitPrice + Number.EPSILON) * 100) / 100).toFixed(2);

  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [quote] = await tx
        .select({ status: quotes.status, version: quotes.version })
        .from(quotes)
        .where(eq(quotes.id, input.quoteId))
        .limit(1);
      if (!quote) return { ok: false, error: "That quote could not be found." };
      if (quote.status !== "draft") return { ok: false, error: "This quote is no longer a draft." };
      if (quote.version !== input.expectedVersion) {
        return {
          ok: false,
          error: "This draft was saved somewhere else. Reload to see the current version.",
        };
      }

      const [maxRow] = await tx
        .select({
          maxNo: sql<number>`coalesce(max(${quote_line_items.line_no}), 0)`,
        })
        .from(quote_line_items)
        .where(eq(quote_line_items.quote_id, input.quoteId));
      const lineNo = Number(maxRow?.maxNo ?? 0) + 1;

      const [created] = await tx
        .insert(quote_line_items)
        .values({
          quote_id: input.quoteId,
          line_no: lineNo,
          line_kind: "custom",
          sku: CUSTOM_SKU,
          katana_variant_id: null,
          qty: "1.0000",
          unit_price: unitPrice,
          price_error: null,
          description,
        })
        .returning({
          id: quote_line_items.id,
          lineNo: quote_line_items.line_no,
          lineKind: quote_line_items.line_kind,
          sku: quote_line_items.sku,
          qty: quote_line_items.qty,
          unitPrice: quote_line_items.unit_price,
          priceError: quote_line_items.price_error,
          description: quote_line_items.description,
        });
      if (!created) throw new Error("Could not add the custom line.");

      const rows = await tx
        .select({
          unitPrice: quote_line_items.unit_price,
          qty: quote_line_items.qty,
        })
        .from(quote_line_items)
        .where(eq(quote_line_items.quote_id, input.quoteId));
      const total = merchandiseTotal(rows);
      const [updated] = await tx
        .update(quotes)
        .set({
          merchandise_total: total,
          version: sql`${quotes.version} + 1`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(quotes.id, input.quoteId),
            eq(quotes.version, input.expectedVersion),
            eq(quotes.status, "draft"),
          ),
        )
        .returning({ version: quotes.version });
      if (!updated) throw new StaleQuoteError();

      return {
        ok: true as const,
        version: updated.version,
        merchandiseTotal: total,
        line: {
          id: created.id,
          lineNo: created.lineNo,
          lineKind: created.lineKind,
          sku: created.sku,
          qty: created.qty,
          unitPrice: created.unitPrice,
          priceError: created.priceError,
          description: created.description,
          holdId: null,
        },
      };
    });
  } catch (error: unknown) {
    if (error instanceof StaleQuoteError) {
      return {
        ok: false,
        error: "This draft was saved somewhere else. Reload to see the current version.",
      };
    }
    throw error;
  }
}

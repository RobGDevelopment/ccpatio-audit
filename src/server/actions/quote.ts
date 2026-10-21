"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getPimSession } from "@/lib/pim-audit";
import {
  isDiscountType,
  lineExtended,
  parseQuoteCommercials,
  quoteGrandTotal,
  type QuoteCommercialInput,
} from "@/lib/quote-financials";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  logistics_profiles,
  quote_line_items,
  quotes,
} from "@/server/db/schema";
import { resolveHoldActor } from "@/server/ghl/hold-actor";
import { personName, records, text } from "@/server/ghl/parse";
import {
  asGhlRecord,
  ghlGet,
  ghlPost,
  ghlPut,
  readGhlConfig,
  updateOpportunityValue,
} from "@/server/ghl/private-api";
import { readDraftCustomer } from "@/server/quotes/draft";
import { lineDescription, merchandiseTotal, snapshotMsrp } from "@/server/quotes/msrp";
import { refreshDraftSnapshot } from "@/server/quotes/load-order-desk";
import { freezeQuote, type SendQuoteError } from "@/server/quotes/send-quote";
import type { OrderDeskLine } from "@/server/quotes/view";

class StaleQuoteDraftError extends Error {
  constructor() {
    super("stale_version");
    this.name = "StaleQuoteDraftError";
  }
}

function revalidateOrderDesk() {
  revalidatePath("/embed/order-desk");
}

function presentSendError(error: SendQuoteError): string {
  switch (error) {
    case "stale_version":
      return "This draft was saved somewhere else. Reload to see the current version.";
    case "not_draft":
      return "This quote is no longer a draft.";
    case "quote_missing":
      return "That quote could not be found.";
    case "no_lines":
      return "Add at least one line before sending.";
    case "unpriced_line":
      return "Every line needs a price before this quote can be sent.";
    case "freight_missing":
      return "Freight must be rated before sending.";
    case "promise_missing":
      return "An estimated delivery date is required before sending.";
    case "dest_zip_invalid":
      return "Destination ZIP must be five digits.";
    case "opportunity_missing":
      return "A GoHighLevel opportunity is required before this quote can be sent.";
    case "opportunity_already_ordered":
      return "This opportunity already has a factory order.";
    default:
      return error;
  }
}

export async function addCatalogFurnitureLine(input: {
  quoteId: string;
  expectedVersion: number;
  sku: string;
  variantId: number;
  qty?: number;
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): Promise<
  | {
      ok: true;
      version: number;
      merchandiseTotal: string | null;
      line: OrderDeskLine;
    }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to add furniture." };

  const actor = await resolveHoldActor({
    ghlUserId: input.ghlUserId,
    ghlUserEmail: input.ghlUserEmail,
  });
  if (!actor.ok) return { ok: false, error: actor.error };

  const sku = input.sku.trim().toUpperCase();
  if (!sku) return { ok: false, error: "Please choose an item." };
  if (!Number.isInteger(input.variantId) || input.variantId <= 0) {
    return { ok: false, error: "Please choose a valid item." };
  }
  const qtyNum = input.qty != null && Number.isFinite(input.qty) && input.qty > 0 ? input.qty : 1;
  const qtyText = qtyNum.toFixed(4);

  const db = getDb();
  const [goods] = await db
    .select({
      msrp: finished_goods_catalog.msrp,
      description: finished_goods_catalog.description,
    })
    .from(finished_goods_catalog)
    .where(inArray(sql<string>`upper(${finished_goods_catalog.global_sku})`, [sku]))
    .limit(1);

  const [profile] = await db
    .select({
      weightLb: logistics_profiles.weight_lb,
      ltlClass: logistics_profiles.ltl_class,
      lengthIn: logistics_profiles.length_in,
      widthIn: logistics_profiles.width_in,
    })
    .from(logistics_profiles)
    .where(eq(logistics_profiles.katana_variant_id, input.variantId))
    .limit(1);

  const price = snapshotMsrp(goods?.msrp);
  const description = lineDescription(sku, goods?.description);

  try {
    const added = await db.transaction(async (tx) => {
      const [quote] = await tx
        .select({ status: quotes.status, version: quotes.version })
        .from(quotes)
        .where(eq(quotes.id, input.quoteId))
        .limit(1);
      if (!quote) return { ok: false as const, error: "That quote could not be found." };
      if (quote.status !== "draft") {
        return { ok: false as const, error: "This quote is no longer a draft." };
      }
      if (quote.version !== input.expectedVersion) {
        return {
          ok: false as const,
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
          line_kind: "configured",
          sku,
          katana_variant_id: input.variantId,
          qty: qtyText,
          unit_price: price.unitPrice,
          price_error: price.priceError,
          description,
          weight_lb: profile?.weightLb ?? null,
          ltl_class: profile?.ltlClass ?? null,
          length_in: profile?.lengthIn ?? null,
          width_in: profile?.widthIn ?? null,
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
      if (!created) throw new Error("Could not add the item.");

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
      if (!updated) throw new StaleQuoteDraftError();

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

    if (added.ok) revalidateOrderDesk();
    return added;
  } catch (error: unknown) {
    if (error instanceof StaleQuoteDraftError) {
      return {
        ok: false,
        error: "This draft was saved somewhere else. Reload to see the current version.",
      };
    }
    throw error;
  }
}

export type QuoteLinePatchInput = {
  id: string;
  qty: string;
  unitPrice: string | null;
  description: string;
};

export async function upsertQuoteDraft(
  input: {
    quoteId: string;
    version: number;
    opportunityId: string | null;
    ghlUserId?: string | null;
    ghlUserEmail?: string | null;
    depositPct?: number | string | null;
    shippingCost?: string | number | null;
    lines?: QuoteLinePatchInput[];
  } & QuoteCommercialInput,
): Promise<
  | {
      ok: true;
      version: number;
      merchandiseTotal: string | null;
      /** Set when the draft saved but GoHighLevel could not be updated with the customer edit. */
      crmSyncError?: string | null;
    }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to save this draft." };

  const actor = await resolveHoldActor({
    ghlUserId: input.ghlUserId,
    ghlUserEmail: input.ghlUserEmail,
  });
  if (!actor.ok) return { ok: false, error: actor.error };

  const commercial = parseQuoteCommercials(input);
  if (!commercial.ok) return commercial;

  let nextDepositPct: string | undefined;
  if (input.depositPct != null && String(input.depositPct).trim() !== "") {
    const parsedDeposit = Number(String(input.depositPct).replace(/[%,\s]/g, ""));
    if (!Number.isFinite(parsedDeposit) || parsedDeposit <= 0 || parsedDeposit > 100) {
      return { ok: false, error: "Deposit percentage must be between 1 and 100." };
    }
    nextDepositPct = parsedDeposit.toFixed(2);
  }

  let nextFreightTotal: string | undefined;
  if (input.shippingCost !== undefined && input.shippingCost !== null && String(input.shippingCost).trim() !== "") {
    const parsedShipping = Number(String(input.shippingCost).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(parsedShipping) || parsedShipping < 0) {
      return { ok: false, error: "Shipping cost must be zero or more." };
    }
    nextFreightTotal = parsedShipping.toFixed(2);
  }

  const normalizedLines: Array<{
    id: string;
    qty: string;
    unitPrice: string | null;
    priceError: string | null;
    description: string;
  }> = [];

  for (const line of input.lines ?? []) {
    const qtyNum = Number(line.qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      return { ok: false, error: "Every item quantity must be greater than zero." };
    }
    const desc = line.description.replace(/\s+/g, " ").trim();
    if (!desc) {
      return { ok: false, error: "Every item needs a name." };
    }
    const rawPrice = line.unitPrice?.trim().replace(/[$,\s]/g, "") ?? "";
    let unitPrice: string | null = null;
    let priceError: string | null = null;
    if (rawPrice) {
      const parsedPrice = Number(rawPrice);
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        return { ok: false, error: "Item price must be zero or more." };
      }
      unitPrice = (Math.round((parsedPrice + Number.EPSILON) * 100) / 100).toFixed(2);
    } else {
      priceError = "MSRP is missing or not a number.";
    }
    normalizedLines.push({
      id: line.id,
      qty: qtyNum.toFixed(4),
      unitPrice,
      priceError,
      description: desc.slice(0, 500),
    });
  }

  // The draft as it stood before this save. Compared with the input to find what the rep edited.
  const customerBefore = await readDraftCustomer(input.quoteId);

  const db = getDb();
  let savedVersion = input.version;
  let nextMerchandiseTotal: string | null = null;

  try {
    const txResult = await db.transaction(async (tx) => {
      const [quote] = await tx
        .select({
          status: quotes.status,
          version: quotes.version,
          merchandiseTotal: quotes.merchandise_total,
        })
        .from(quotes)
        .where(eq(quotes.id, input.quoteId))
        .limit(1);
      if (!quote || quote.status !== "draft") {
        return { ok: false as const, error: "not_draft" as const };
      }
      if (quote.version !== input.version) {
        return { ok: false as const, error: "stale_version" as const };
      }

      for (const patchLine of normalizedLines) {
        await tx
          .update(quote_line_items)
          .set({
            qty: patchLine.qty,
            unit_price: patchLine.unitPrice,
            price_error: patchLine.priceError,
            description: patchLine.description,
            updated_at: new Date(),
          })
          .where(
            and(
              eq(quote_line_items.id, patchLine.id),
              eq(quote_line_items.quote_id, input.quoteId),
            ),
          );
      }

      const allLines = await tx
        .select({
          unitPrice: quote_line_items.unit_price,
          qty: quote_line_items.qty,
        })
        .from(quote_line_items)
        .where(eq(quote_line_items.quote_id, input.quoteId));
      const computedMerchandise =
        normalizedLines.length > 0 ? merchandiseTotal(allLines) : quote.merchandiseTotal;

      const [updated] = await tx
        .update(quotes)
        .set({
          customer_name: commercial.patch.customerName,
          customer_email: commercial.patch.customerEmail,
          bill_to_address: commercial.patch.billToAddress,
          ship_to_address: commercial.patch.shipToAddress,
          discount_amount: commercial.patch.discountAmount,
          discount_type: commercial.patch.discountType,
          tax_amount: commercial.patch.taxAmount,
          ...(nextDepositPct !== undefined ? { deposit_pct: nextDepositPct } : {}),
          ...(nextFreightTotal !== undefined ? { freight_total: nextFreightTotal } : {}),
          merchandise_total: computedMerchandise,
          version: sql`${quotes.version} + 1`,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(quotes.id, input.quoteId),
            eq(quotes.version, input.version),
            eq(quotes.status, "draft"),
          ),
        )
        .returning({
          version: quotes.version,
          merchandiseTotal: quotes.merchandise_total,
        });

      if (!updated) throw new StaleQuoteDraftError();
      return {
        ok: true as const,
        version: updated.version,
        merchandiseTotal: updated.merchandiseTotal,
      };
    });

    if (!txResult.ok) {
      return {
        ok: false,
        error:
          txResult.error === "stale_version"
            ? "This draft was saved somewhere else. Reload to see the current version."
            : "This quote is no longer a draft.",
      };
    }

    savedVersion = txResult.version;
    nextMerchandiseTotal = txResult.merchandiseTotal;
  } catch (error: unknown) {
    if (error instanceof StaleQuoteDraftError) {
      return {
        ok: false,
        error: "This draft was saved somewhere else. Reload to see the current version.",
      };
    }
    throw error;
  }

  const opportunityId = input.opportunityId?.trim() ?? "";
  if (!opportunityId) {
    revalidateOrderDesk();
    return { ok: true, version: savedVersion, merchandiseTotal: nextMerchandiseTotal };
  }

  // Hub -> GHL: pushes the customer fields the rep changed, and pulls back anything the CRM
  // changed in the meantime, so the draft and the opportunity card read the same.
  const refreshed = await refreshDraftSnapshot({
    quoteId: input.quoteId,
    version: savedVersion,
    opportunityId,
    customer: {
      before: customerBefore,
      next: {
        customerName: commercial.patch.customerName ?? "",
        customerEmail: commercial.patch.customerEmail ?? "",
        billToAddress: commercial.patch.billToAddress ?? "",
      },
    },
  });
  if (!refreshed.ok) return refreshed;

  revalidateOrderDesk();
  return {
    ok: true,
    version: refreshed.version,
    merchandiseTotal: nextMerchandiseTotal,
    crmSyncError: refreshed.crmSyncError,
  };
}

export type GhlCustomerHit = {
  contactId: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** Null when the customer has no open or won opportunity, so a quote cannot start yet. */
  opportunityId: string | null;
  opportunityName: string | null;
};

const CUSTOMER_SEARCH_MAX_RESULTS = 20;
const CUSTOMER_SEARCH_CONTACT_LOOKUPS = 5;

/** A typed phone number such as "(480) 555-1212" is searched as digits, which is how the CRM stores it. */
function customerSearchTerm(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (/^[\d\s().+-]+$/.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length >= 7) return digits;
  }
  return trimmed;
}

function hitFromOpportunity(row: Record<string, unknown>): GhlCustomerHit | null {
  const status = text(row.status).toLowerCase();
  if (status !== "open" && status !== "won") return null;
  const contact = asGhlRecord(row.contact);
  const opportunityId = text(row.id);
  const contactId = text(row.contactId) || text(row.contact_id) || text(contact?.id);
  if (!opportunityId || !contactId) return null;
  const opportunityName = text(row.name);
  return {
    contactId,
    name: personName(contact) || text(row.contactName) || text(row.contact_name) || opportunityName,
    email: text(contact?.email) || null,
    phone: text(contact?.phone) || null,
    opportunityId,
    opportunityName: opportunityName || null,
  };
}

/**
 * Customer search for the Order Desk hub. Looks a name, email, or phone number up in GoHighLevel
 * with the private integration token and returns one row per open or won opportunity, plus one
 * row for a matching customer that has no opportunity yet. The token never leaves the server.
 */
export async function searchGhlCustomers(
  query: string,
): Promise<{ ok: true; results: GhlCustomerHit[] } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to search for a customer." };

  const term = customerSearchTerm(typeof query === "string" ? query : "");
  if (term.length < 2) return { ok: true, results: [] };
  if (term.length > 80) return { ok: false, error: "Please use a shorter search." };

  const config = readGhlConfig();
  if ("error" in config) return { ok: false, error: config.error };
  const location = encodeURIComponent(config.locationId);
  const encoded = encodeURIComponent(term);

  const [open, won, contacts] = await Promise.all([
    ghlGet(`/opportunities/search?location_id=${location}&q=${encoded}&status=open&limit=20`),
    ghlGet(`/opportunities/search?location_id=${location}&q=${encoded}&status=won&limit=20`),
    ghlGet(`/contacts/?locationId=${location}&query=${encoded}&limit=${CUSTOMER_SEARCH_CONTACT_LOOKUPS}`),
  ]);
  if (!open.ok) return { ok: false, error: open.error };
  if (!won.ok) return { ok: false, error: won.error };
  if (!contacts.ok) return { ok: false, error: contacts.error };

  const hits = new Map<string, GhlCustomerHit>();
  for (const row of [...records(open.body, "opportunities"), ...records(won.body, "opportunities")]) {
    const hit = hitFromOpportunity(row);
    if (hit?.opportunityId && !hits.has(hit.opportunityId)) hits.set(hit.opportunityId, hit);
  }

  // A matching customer whose opportunity did not match the text still has to be findable.
  const seenContacts = new Set([...hits.values()].map((hit) => hit.contactId));
  const extraContacts = records(contacts.body, "contacts")
    .filter((contact) => {
      const id = text(contact.id);
      return id !== "" && !seenContacts.has(id);
    })
    .slice(0, CUSTOMER_SEARCH_CONTACT_LOOKUPS);

  const lookups = await Promise.all(
    extraContacts.map((contact) =>
      ghlGet(
        `/opportunities/search?location_id=${location}&contact_id=${encodeURIComponent(text(contact.id))}&limit=20`,
      ),
    ),
  );
  const extraHits: GhlCustomerHit[] = [];
  for (const [index, lookup] of lookups.entries()) {
    if (!lookup.ok) return { ok: false, error: lookup.error };
    const contact = extraContacts[index];
    if (!contact) continue;
    const contactId = text(contact.id);
    const email = text(contact.email) || null;
    const phone = text(contact.phone) || null;
    const contactName = personName(contact);
    const name = contactName || email || phone || "Customer";
    const opportunities = records(lookup.body, "opportunities").flatMap((row) => {
      const hit = hitFromOpportunity(row);
      return hit ? [hit] : [];
    });
    if (opportunities.length === 0) {
      extraHits.push({
        contactId,
        name,
        email,
        phone,
        opportunityId: null,
        opportunityName: null,
      });
      continue;
    }
    // The contact record is the fullest source for who this is, so it fills any gap in the row.
    for (const hit of opportunities) {
      extraHits.push({
        ...hit,
        contactId,
        name: contactName || hit.name || name,
        email: hit.email ?? email,
        phone: hit.phone ?? phone,
      });
    }
  }
  for (const hit of extraHits) {
    if (hit.opportunityId && hits.has(hit.opportunityId)) continue;
    hits.set(hit.opportunityId ?? `contact:${hit.contactId}`, hit);
  }

  const results = [...hits.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || (a.opportunityName ?? "").localeCompare(b.opportunityName ?? ""))
    .slice(0, CUSTOMER_SEARCH_MAX_RESULTS);
  return { ok: true, results };
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

async function pushCpqNoteToGhl(quoteId: string): Promise<void> {
  const db = getDb();
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, quoteId)).limit(1);
  if (!quote || !quote.ghl_opportunity_id) return;

  const lines = await db
    .select()
    .from(quote_line_items)
    .where(eq(quote_line_items.quote_id, quoteId))
    .orderBy(quote_line_items.line_no);

  const subtotal = lines.reduce(
    (sum, line) => sum + (lineExtended(line.unit_price, line.qty) ?? 0),
    0,
  );
  const shipping = quote.freight_total != null ? Number(quote.freight_total) : 0;
  const discountType = isDiscountType(quote.discount_type) ? quote.discount_type : "FLAT";
  const totals = quoteGrandTotal({
    subtotal,
    discountAmount: Number(quote.discount_amount),
    discountType,
    tax: Number(quote.tax_amount),
    shipping: Number.isFinite(shipping) ? shipping : 0,
  });
  const pct = Number(quote.deposit_pct ?? "50") || 50;
  const depositDue = Math.round(totals.total * pct) / 100;

  const summaryLines = [
    `CC Patio Proposal (${quote.id.slice(0, 8).toUpperCase()})`,
    ...lines.map((line) => {
      const ext = lineExtended(line.unit_price, line.qty) ?? 0;
      const qtyClean = Number(line.qty) || line.qty;
      return `- ${line.description} x ${qtyClean}: ${formatMoney(ext)}`;
    }),
    `Subtotal: ${formatMoney(subtotal)}`,
    ...(totals.discount > 0 ? [`Discount: -${formatMoney(totals.discount)}`] : []),
    ...(totals.tax > 0 ? [`Tax: ${formatMoney(totals.tax)}`] : []),
    `Delivery: ${formatMoney(totals.shipping)}`,
    `Grand Total: ${formatMoney(totals.total)}`,
    `Required ${pct}% Deposit: ${formatMoney(depositDue)}`,
  ].join("\n");

  const fieldId = process.env.GHL_OPPORTUNITY_BUILD_SUMMARY_FIELD_ID?.trim() || "";
  if (fieldId) {
    await ghlPut(`/opportunities/${encodeURIComponent(quote.ghl_opportunity_id)}`, {
      customFields: [{ id: fieldId, field_value: summaryLines }],
    });
    return;
  }

  let contactId = quote.ghl_contact_id?.trim() || "";
  if (!contactId) {
    const oppRes = await ghlGet(`/opportunities/${encodeURIComponent(quote.ghl_opportunity_id)}`);
    if (oppRes.ok) {
      const oppBody = asGhlRecord(oppRes.body);
      const oppRecord = asGhlRecord(oppBody?.opportunity) ?? oppBody;
      const rawContact = oppRecord?.contactId ?? asGhlRecord(oppRecord?.contact)?.id;
      if (typeof rawContact === "string") contactId = rawContact.trim();
    }
  }
  if (contactId) {
    await ghlPost(`/contacts/${encodeURIComponent(contactId)}/notes`, {
      body: summaryLines,
    });
  }
}

export async function finalizeAndSyncQuoteToGhl(input: {
  quoteId: string;
  expectedVersion: number;
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): Promise<
  | {
      ok: true;
      version: number;
      revisionId: string;
      status: "sent";
      amountDue: string;
      ghlSyncError: string | null;
    }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to send this quote." };

  const actor = await resolveHoldActor({
    ghlUserId: input.ghlUserId ?? undefined,
    ghlUserEmail: input.ghlUserEmail ?? undefined,
  });
  if (!actor.ok) return { ok: false, error: actor.error };

  const frozen = await freezeQuote({
    quoteId: input.quoteId,
    expectedVersion: input.expectedVersion,
    actor,
    syncOpportunityValue: async (opportunityId, value) => {
      const synced = await updateOpportunityValue(opportunityId, value);
      if (!synced.ok) return synced;
      try {
        await pushCpqNoteToGhl(input.quoteId);
      } catch {
        // Non-fatal: monetaryValue succeeded
      }
      return { ok: true };
    },
  });
  if (!frozen.ok) return { ok: false, error: presentSendError(frozen.error) };

  revalidateOrderDesk();
  return {
    ok: true,
    version: frozen.version,
    revisionId: frozen.revisionId,
    status: frozen.status,
    amountDue: frozen.amountDue,
    ghlSyncError: frozen.ghlSyncError,
  };
}

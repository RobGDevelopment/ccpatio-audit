import { eq } from "drizzle-orm";
import { logStructured } from "@/lib/log/structured";
import { getPimSession } from "@/lib/pim-audit";
import { getDb } from "@/server/db/client";
import { quotes } from "@/server/db/schema";
import { resolveHoldActor } from "@/server/ghl/hold-actor";
import { asGhlRecord, ghlGet, ghlPut } from "@/server/ghl/private-api";
import {
  createDraftFromResolved,
  loadQuoteDocument,
  loadQuoteDocumentById,
  readDraftCustomer,
  saveDraftVersion,
  type DraftCustomer,
} from "@/server/quotes/draft";
import { postalZip } from "@/server/quotes/postal-zip";
import type { OrderDeskModel, OrderDeskQuote } from "@/server/quotes/view";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unwrap(body: unknown, key: string): Record<string, unknown> | null {
  const record = asGhlRecord(body);
  if (!record) return null;
  return asGhlRecord(record[key]) ?? record;
}

/**
 * The CRM contact as the quote sees it. Phone is read live and never stored on the quote.
 * Every field is null when the CRM holds nothing for it.
 */
export type CrmCustomer = {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Multi-line: street, then "City, ST ZIP". */
  address: string | null;
};

/** The customer fields the rep can edit on the quote and that the CRM contact also holds. */
export type CustomerField = "name" | "email" | "address";

type LoadedOpportunity = {
  id: string;
  name: string;
  contactId: string;
  status: "open" | "won" | "lost" | "abandoned";
  destZip: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  billToAddress: string | null;
  shipToAddress: string | null;
  /** Null when the contact record itself could not be read. */
  crm: CrmCustomer | null;
};

/* ---------------------------------------------------------------------------------------------
 * Customer mirror: pure planning. The CRM is the system of record for the contact, so on a load
 * it wins every difference. The quote wins only where the rep just edited it, and that edit is
 * pushed to the CRM in the same save. Nothing here ever blanks a field on either side.
 * ------------------------------------------------------------------------------------------- */

function squash(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return squash(a).toLowerCase() === squash(b).toLowerCase();
}

/** Line breaks, commas, periods and case do not make two addresses different. */
function canonAddress(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[\s,.]+/g, " ").trim();
}

/**
 * What to write onto the draft so it matches the CRM contact. Null when it already matches.
 * `protect` holds fields the rep edited in this very save: those keep the rep's value.
 */
export function planCrmMirror(
  local: DraftCustomer,
  crm: CrmCustomer,
  protect: ReadonlySet<CustomerField> = new Set(),
): Partial<DraftCustomer> | null {
  const patch: Partial<DraftCustomer> = {};
  if (!protect.has("name") && crm.name && !sameText(local.customerName, crm.name)) {
    patch.customerName = crm.name;
  }
  if (!protect.has("email") && crm.email && !sameText(local.customerEmail, crm.email)) {
    patch.customerEmail = crm.email;
  }
  if (
    !protect.has("address") &&
    crm.address &&
    canonAddress(local.billToAddress) !== canonAddress(crm.address)
  ) {
    patch.billToAddress = crm.address;
    // The delivery address follows the CRM address only while it was following it before.
    const deliveryFollows =
      !squash(local.shipToAddress) ||
      canonAddress(local.shipToAddress) === canonAddress(local.billToAddress);
    if (deliveryFollows) patch.shipToAddress = crm.address;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

type CrmAddressParts = {
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

/** Splits "Street, City, ST 85001" (commas or line breaks) into the contact's address fields. */
export function parseAddressForCrm(raw: string): CrmAddressParts {
  const parts = raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};

  const result: CrmAddressParts = {};
  const tail = parts[parts.length - 1] ?? "";
  const stateZip = /^(?:([A-Za-z]{2})\s+)?(\d{5})(?:-\d{4})?$/.exec(tail);
  if (stateZip) {
    parts.pop();
    result.postalCode = stateZip[2];
    if (stateZip[1]) result.state = stateZip[1].toUpperCase();
    else if (/^[A-Za-z]{2}$/.test(parts[parts.length - 1] ?? "")) {
      result.state = (parts.pop() ?? "").toUpperCase();
    }
  } else if (/^[A-Za-z]{2}$/.test(tail) && parts.length > 1) {
    parts.pop();
    result.state = tail.toUpperCase();
  }

  // With a state or ZIP found, the part before it is the city, provided a street remains.
  if ((result.state || result.postalCode) && parts.length >= 2) {
    result.city = parts.pop();
  }
  const street = parts.join(", ");
  if (street) result.address1 = street;
  return result;
}

export type CrmPushPlan = {
  /** Which CRM contact fields this plan writes. */
  fields: CustomerField[];
  /** Body for PUT /contacts/:id. */
  contact: Record<string, unknown>;
  /** New opportunity name for PUT /opportunities/:id, or null to leave the opportunity alone. */
  opportunityName: string | null;
};

const FROZEN_SUFFIX = /\s*\[Quote-Frozen:[^\]]*\]\s*$/;

/**
 * Compares what the rep just saved with what the CRM holds. `edited` is every field the rep
 * changed in this save; `plan` writes those that also differ from the CRM and are not blank.
 * A field the rep did not touch is never pushed, so a stale screen cannot overwrite a newer
 * CRM edit.
 */
export function planCrmPush(
  next: { customerName: string; customerEmail: string; billToAddress: string },
  before: DraftCustomer,
  crm: CrmCustomer,
  opportunityName: string,
): { edited: Set<CustomerField>; plan: CrmPushPlan | null } {
  const edited = new Set<CustomerField>();
  if (!sameText(next.customerName, before.customerName)) edited.add("name");
  if (!sameText(next.customerEmail, before.customerEmail)) edited.add("email");
  if (canonAddress(next.billToAddress) !== canonAddress(before.billToAddress)) {
    edited.add("address");
  }

  const fields: CustomerField[] = [];
  const contact: Record<string, unknown> = {};
  let nextOpportunityName: string | null = null;

  const name = squash(next.customerName);
  if (edited.has("name") && name && !sameText(name, crm.name)) {
    const [first = name, ...rest] = name.split(" ");
    contact.name = name;
    contact.firstName = first;
    contact.lastName = rest.join(" ");
    fields.push("name");

    // The opportunity carries the customer's name only when it was already following it.
    const suffix = FROZEN_SUFFIX.exec(opportunityName)?.[0] ?? "";
    const base = suffix ? opportunityName.slice(0, opportunityName.length - suffix.length) : opportunityName;
    if (crm.name && sameText(base, crm.name)) {
      nextOpportunityName = `${name}${suffix ? ` ${suffix.trim()}` : ""}`;
    }
  }

  const email = squash(next.customerEmail);
  if (edited.has("email") && email && !sameText(email, crm.email)) {
    contact.email = email;
    fields.push("email");
  }

  const address = next.billToAddress.trim();
  if (edited.has("address") && address && canonAddress(address) !== canonAddress(crm.address)) {
    Object.assign(contact, parseAddressForCrm(address));
    fields.push("address");
  }

  if (fields.length === 0) return { edited, plan: null };
  return { edited, plan: { fields, contact, opportunityName: nextOpportunityName } };
}

async function pushCrmPlan(
  target: { contactId: string; opportunityId: string },
  plan: CrmPushPlan,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (Object.keys(plan.contact).length > 0) {
    const updated = await ghlPut(`/contacts/${encodeURIComponent(target.contactId)}`, plan.contact);
    if (!updated.ok) {
      return { ok: false, error: `The customer was not updated in GoHighLevel. ${updated.error}` };
    }
  }
  if (plan.opportunityName) {
    const renamed = await ghlPut(`/opportunities/${encodeURIComponent(target.opportunityId)}`, {
      name: plan.opportunityName,
    });
    if (!renamed.ok) {
      return {
        ok: false,
        error: `The customer was updated in GoHighLevel, but the opportunity name was not. ${renamed.error}`,
      };
    }
  }
  return { ok: true };
}

const NO_CRM: CrmCustomer = { name: null, email: null, phone: null, address: null };

function formatContactAddress(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  const line1 = text(record.address1) || text(record.address);
  const city = text(record.city);
  const state = text(record.state);
  const zip = text(record.postalCode) || text(record.zip);
  const cityStateZip = [city, state].filter(Boolean).join(", ") + (zip ? ` ${zip}` : "");
  const parts = [line1, cityStateZip.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

function contactName(record: Record<string, unknown> | null): string {
  if (!record) return "";
  return (
    text(record.name) ||
    [text(record.firstName), text(record.lastName)].filter(Boolean).join(" ") ||
    text(record.contactName)
  );
}

async function resolveContactDetails(
  opportunity: Record<string, unknown>,
  contactId: string,
): Promise<{
  destZip: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  billToAddress: string | null;
  shipToAddress: string | null;
  crm: CrmCustomer | null;
}> {
  const nested = asGhlRecord(opportunity.contact);
  const loaded = await ghlGet(`/contacts/${encodeURIComponent(contactId)}`);
  const fetched = loaded.ok ? unwrap(loaded.body, "contact") : null;
  if (!loaded.ok) {
    logStructured("warn", "order-desk-contact-read-failed", { error: loaded.error });
  }
  const source = fetched ?? nested;

  const destZip =
    postalZip(opportunity) ?? postalZip(nested) ?? postalZip(fetched) ?? null;

  const fullName =
    contactName(source) ||
    text(opportunity.contactName) ||
    text(opportunity.name);
  const email = text(source?.email) || text(nested?.email);
  const phone = text(source?.phone) || text(nested?.phone);
  const address = formatContactAddress(fetched) ?? formatContactAddress(nested);

  return {
    destZip,
    customerName: fullName || null,
    customerEmail: email || null,
    customerPhone: phone || null,
    billToAddress: address,
    shipToAddress: address,
    // Only a contact record read just now may overwrite a draft. Its name is never the
    // opportunity name, which the line above falls back to for a new draft.
    crm: fetched
      ? {
          name: contactName(fetched) || null,
          email: text(fetched.email) || null,
          phone: text(fetched.phone) || null,
          address: formatContactAddress(fetched),
        }
      : null,
  };
}

/**
 * Opportunity read for Order Desk. Lost and abandoned are returned so an
 * existing quote can still open. They do not create a draft.
 */
async function loadOpportunity(
  opportunityId: string,
): Promise<{ ok: true } & LoadedOpportunity | { ok: false; error: string }> {
  const loaded = await ghlGet(`/opportunities/${encodeURIComponent(opportunityId)}`);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const opportunity = unwrap(loaded.body, "opportunity");
  if (!opportunity) {
    return { ok: false, error: "GoHighLevel could not load that opportunity." };
  }

  const returnedId = text(opportunity.id);
  if (returnedId && returnedId !== opportunityId) {
    return { ok: false, error: "GoHighLevel returned a different opportunity." };
  }
  const locationId = text(opportunity.locationId);
  if (locationId && locationId !== loaded.locationId) {
    return { ok: false, error: "That opportunity is in a different location." };
  }

  const status = text(opportunity.status).toLowerCase();
  if (
    status !== "open" &&
    status !== "won" &&
    status !== "lost" &&
    status !== "abandoned"
  ) {
    return { ok: false, error: "That opportunity cannot open a quote." };
  }

  const contactId = text(opportunity.contactId);
  const name = text(opportunity.name);
  if (!contactId) return { ok: false, error: "That opportunity has no contact." };
  if (!name) return { ok: false, error: "That opportunity has no name." };

  const contactDetails = await resolveContactDetails(opportunity, contactId);

  return {
    ok: true,
    id: returnedId || opportunityId,
    name,
    contactId,
    status,
    ...contactDetails,
  };
}

/**
 * GHL -> Hub. Writes the CRM's latest contact and opportunity details onto an open draft before
 * it reaches the screen. A sent, paid, or closed quote is a frozen document and is never touched.
 * The phone number is only ever read from the CRM, so it is attached to the returned model.
 */
async function mirrorDraftFromCrm(
  existing: OrderDeskQuote,
  opportunity: LoadedOpportunity,
  reload: () => Promise<OrderDeskQuote | null>,
): Promise<OrderDeskQuote> {
  const withPhone = (quote: OrderDeskQuote): OrderDeskQuote => ({
    ...quote,
    customerPhone: opportunity.crm?.phone ?? null,
  });
  if (existing.status !== "draft" || existing.readOnly) return withPhone(existing);

  const local = await readDraftCustomer(existing.quoteId);
  const customer = local && opportunity.crm ? planCrmMirror(local, opportunity.crm) : null;
  const opportunityChanged =
    existing.opportunityName !== opportunity.name ||
    (existing.contactId ?? null) !== opportunity.contactId;
  if (!customer && !opportunityChanged) return withPhone(existing);

  // A stale version here means another save landed first. The reload below returns that row.
  await saveDraftVersion({
    quoteId: existing.quoteId,
    version: existing.version,
    patch: {
      ghlOpportunityName: opportunity.name,
      ghlContactId: opportunity.contactId,
      destZip: existing.destZip ?? opportunity.destZip,
      ...(customer ? { customer } : {}),
    },
  });
  const reloaded = await reload();
  return withPhone(reloaded ?? existing);
}

/**
 * A quote opened by id (a walk-in, or a link from the dispatch queue). The CRM refresh is a
 * courtesy here: when the CRM cannot be reached the saved quote still opens, and the next save
 * or load tries again.
 */
async function mirrorQuoteOpenedById(quote: OrderDeskQuote): Promise<OrderDeskQuote> {
  if (!quote.opportunityId || quote.status !== "draft" || quote.readOnly) return quote;
  const opportunity = await loadOpportunity(quote.opportunityId);
  if (!opportunity.ok) {
    logStructured("warn", "order-desk-crm-mirror-skipped", {
      quoteId: quote.quoteId,
      error: opportunity.error,
    });
    return quote;
  }
  if (opportunity.status === "lost" || opportunity.status === "abandoned") return quote;
  return mirrorDraftFromCrm(quote, opportunity, () => loadQuoteDocumentById(quote.quoteId));
}

export async function loadOrderDesk(input: {
  opportunityId?: string | null;
  quoteId?: string | null;
  contactId?: string | null;
  locationId?: string | null;
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): Promise<OrderDeskModel> {
  const session = await getPimSession();
  if (!session) return { state: "error", message: "Sign in to open Order Desk." };

  const opportunityId = input.opportunityId?.trim() ?? "";
  const quoteId = input.quoteId?.trim() ?? "";
  if (!opportunityId && quoteId) {
    const actor = await resolveHoldActor({
      ghlUserId: input.ghlUserId,
      ghlUserEmail: input.ghlUserEmail,
    });
    if (!actor.ok) return { state: "error", message: actor.error };
    const quote = await loadQuoteDocumentById(quoteId);
    if (!quote) return { state: "error", message: "That quote could not be found." };
    return mirrorQuoteOpenedById(quote);
  }
  if (!opportunityId) return { state: "needs-opportunity" };

  const actor = await resolveHoldActor({
    ghlUserId: input.ghlUserId,
    ghlUserEmail: input.ghlUserEmail,
  });
  if (!actor.ok) return { state: "error", message: actor.error };

  const opportunity = await loadOpportunity(opportunityId);
  if (!opportunity.ok) return { state: "error", message: opportunity.error };

  if (opportunity.status === "lost" || opportunity.status === "abandoned") {
    const existing = await loadQuoteDocument(opportunity.id, true);
    if (existing) {
      return { ...existing, customerPhone: opportunity.crm?.phone ?? null };
    }
    return {
      state: "error",
      message: "That opportunity is lost or abandoned.",
    };
  }

  const existing = await loadQuoteDocument(opportunity.id);
  if (existing) {
    return mirrorDraftFromCrm(existing, opportunity, () => loadQuoteDocument(opportunity.id));
  }

  const created = await createDraftFromResolved({
    actor,
    opportunity,
    destZip: opportunity.destZip,
  });
  return { ...created, customerPhone: opportunity.customerPhone };
}

/**
 * Runs after a draft save. Re-reads the opportunity and contact from the CRM, then keeps the
 * two sides identical:
 *
 *  - Hub -> GHL: when `customer` is given, every customer field the rep changed in this save
 *    (compared with `before`, the draft as it was) is written to the CRM contact and, when the
 *    opportunity was named after the customer, to the opportunity.
 *  - GHL -> Hub: every other field the CRM holds differently is written onto the draft.
 *
 * A failed CRM write does not undo the saved draft. It comes back as `crmSyncError`, and the
 * rep's unsynced edit stays on the draft until the next load.
 */
export async function refreshDraftSnapshot(input: {
  quoteId: string;
  version: number;
  opportunityId: string;
  customer?: {
    before: DraftCustomer | null;
    next: { customerName: string; customerEmail: string; billToAddress: string };
  };
}): Promise<
  { ok: true; version: number; crmSyncError: string | null } | { ok: false; error: string }
> {
  const opportunity = await loadOpportunity(input.opportunityId);
  if (!opportunity.ok) return { ok: false, error: opportunity.error };
  if (opportunity.status === "lost" || opportunity.status === "abandoned") {
    return { ok: false, error: "That opportunity is lost or abandoned." };
  }

  let crmSyncError: string | null = null;
  let opportunityName = opportunity.name;
  const protect = new Set<CustomerField>();
  if (input.customer?.before) {
    const { edited, plan } = planCrmPush(
      input.customer.next,
      input.customer.before,
      opportunity.crm ?? NO_CRM,
      opportunity.name,
    );
    for (const field of edited) protect.add(field);
    if (plan) {
      const pushed = await pushCrmPlan(
        { contactId: opportunity.contactId, opportunityId: opportunity.id },
        plan,
      );
      if (!pushed.ok) crmSyncError = pushed.error;
      else if (plan.opportunityName) opportunityName = plan.opportunityName;
    }
  }

  const [current] = await getDb()
    .select({ destZip: quotes.dest_zip })
    .from(quotes)
    .where(eq(quotes.id, input.quoteId))
    .limit(1);
  const savedCustomer = opportunity.crm ? await readDraftCustomer(input.quoteId) : null;
  const mirror =
    savedCustomer && opportunity.crm ? planCrmMirror(savedCustomer, opportunity.crm, protect) : null;
  const saved = await saveDraftVersion({
    quoteId: input.quoteId,
    version: input.version,
    patch: {
      ghlOpportunityName: opportunityName,
      ghlContactId: opportunity.contactId,
      destZip: current ? current.destZip?.trim() || null : opportunity.destZip,
      ...(mirror ? { customer: mirror } : {}),
    },
  });
  if (!saved.ok) {
    return {
      ok: false,
      error:
        saved.error === "stale_version"
          ? "This draft was saved somewhere else. Reload to see the current version."
          : "This quote is no longer a draft.",
    };
  }
  return { ok: true, version: saved.version, crmSyncError };
}

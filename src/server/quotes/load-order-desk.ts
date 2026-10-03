import { eq } from "drizzle-orm";
import { getPimSession } from "@/lib/pim-audit";
import { getDb } from "@/server/db/client";
import { quotes } from "@/server/db/schema";
import { resolveHoldActor } from "@/server/ghl/hold-actor";
import { asGhlRecord, ghlGet } from "@/server/ghl/private-api";
import {
  createDraftFromResolved,
  loadQuoteDocument,
  loadQuoteDocumentById,
  saveDraftVersion,
} from "@/server/quotes/draft";
import { postalZip } from "@/server/quotes/postal-zip";
import type { OrderDeskModel } from "@/server/quotes/view";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unwrap(body: unknown, key: string): Record<string, unknown> | null {
  const record = asGhlRecord(body);
  if (!record) return null;
  return asGhlRecord(record[key]) ?? record;
}

type LoadedOpportunity = {
  id: string;
  name: string;
  contactId: string;
  status: "open" | "won" | "lost" | "abandoned";
  destZip: string | null;
};

async function destinationZip(
  opportunity: Record<string, unknown>,
  contactId: string,
): Promise<string | null> {
  const onOpportunity = postalZip(opportunity);
  if (onOpportunity) return onOpportunity;
  const contact = asGhlRecord(opportunity.contact);
  const onNested = postalZip(contact);
  if (onNested) return onNested;
  const loaded = await ghlGet(`/contacts/${encodeURIComponent(contactId)}`);
  if (!loaded.ok) return null;
  return postalZip(unwrap(loaded.body, "contact"));
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

  return {
    ok: true,
    id: returnedId || opportunityId,
    name,
    contactId,
    status,
    destZip: await destinationZip(opportunity, contactId),
  };
}

export async function loadOrderDesk(input: {
  opportunityId?: string | null;
  quoteId?: string | null;
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
    return quote;
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
    if (existing) return existing;
    return {
      state: "error",
      message: "That opportunity is lost or abandoned.",
    };
  }

  const existing = await loadQuoteDocument(opportunity.id);
  if (existing) return existing;

  return createDraftFromResolved({
    actor,
    opportunity,
    destZip: opportunity.destZip,
  });
}

export async function refreshDraftSnapshot(input: {
  quoteId: string;
  version: number;
  opportunityId: string;
}): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const opportunity = await loadOpportunity(input.opportunityId);
  if (!opportunity.ok) return { ok: false, error: opportunity.error };
  if (opportunity.status === "lost" || opportunity.status === "abandoned") {
    return { ok: false, error: "That opportunity is lost or abandoned." };
  }

  const [current] = await getDb()
    .select({ destZip: quotes.dest_zip })
    .from(quotes)
    .where(eq(quotes.id, input.quoteId))
    .limit(1);
  const saved = await saveDraftVersion({
    quoteId: input.quoteId,
    version: input.version,
    patch: {
      ghlOpportunityName: opportunity.name,
      ghlContactId: opportunity.contactId,
      destZip: current ? current.destZip?.trim() || null : opportunity.destZip,
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
  return { ok: true, version: saved.version };
}

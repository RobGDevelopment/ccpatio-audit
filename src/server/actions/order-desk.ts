"use server";

import { revalidatePath } from "next/cache";
import { getPimSession } from "@/lib/pim-audit";
import { resolveHoldActor } from "@/server/ghl/hold-actor";
import { createHold, releaseHold, type HoldActorHint } from "@/server/actions/inventory";
import { searchFinishedGoods, type OrderDeskCatalogProduct } from "@/server/quotes/catalog-search";
import {
  legacyFabricReleaseError,
  removeHeldQuoteLine,
  swapHeldQuoteLine,
  type QuoteHoldMutation,
  type QuoteHoldPorts,
} from "@/server/quotes/hold-lines";
import { calculatePromiseById } from "@/server/quotes/calculate-promise";
import {
  overrideQuoteDistanceMiles,
  overrideQuoteFreightTotal,
  overrideQuotePromiseDate,
  requireCommercialOverride,
} from "@/server/quotes/freight-override";
import { addCustomQuoteLine } from "@/server/quotes/custom-line";
import { createWalkInDraft, saveQuoteCommercials, stampEstimateFreight } from "@/server/quotes/draft";
import { parseQuoteCommercials, type QuoteCommercialInput } from "@/lib/quote-financials";
import { loadOrderDesk, refreshDraftSnapshot } from "@/server/quotes/load-order-desk";
import {
  freezeQuote,
  revertQuoteToDraft,
  type RevertQuoteError,
  type SendQuoteError,
} from "@/server/quotes/send-quote";
import {
  rateQuoteById,
  selectQuoteFreightMethodById,
  type RateQuoteFreightResult,
} from "@/server/quotes/rate-freight";
import type { CalculatedPromise } from "@/server/quotes/calculate-promise";
import type { OrderDeskLine, OrderDeskModel } from "@/server/quotes/view";
import type { FulfillmentMethod } from "@/types/freight";

export type { OrderDeskCatalogProduct, QuoteHoldMutation };

function presentHoldError(error: string): string {
  switch (error) {
    case "stale_version":
      return "This draft was saved somewhere else. Reload to see the current version.";
    case "not_draft":
      return "This quote is no longer a draft.";
    case "quote_missing":
      return "That quote could not be found.";
    case "line_missing":
      return "That line is not on this quote.";
    case "line_changed":
      return "This line changed. Reload to see the current draft.";
    case "hold_missing":
      return "That hold is no longer on the ledger.";
    case "no_hold":
      return "That line has no hold to swap.";
    case "not_on_opportunity":
      return "That hold belongs to a different opportunity.";
    case "expired":
      return "That hold has expired.";
    case "lost":
      return "That hold was released because the opportunity was lost.";
    case "abandoned":
      return "That hold was released because the opportunity was abandoned.";
    case "manual":
      return "That hold was already released.";
    case "releasing":
      return "That hold is already being released.";
    case "converting":
      return "That hold is already being converted.";
    case "converted":
      return "That hold was already converted.";
    default:
      return error;
  }
}

function present(result: QuoteHoldMutation): QuoteHoldMutation {
  if (result.ok || result.error === "previous_hold_still_active") return result;
  return { ...result, error: presentHoldError(result.error) };
}

function actorHint(input?: {
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): HoldActorHint {
  return {
    ghlUserId: input?.ghlUserId ?? undefined,
    ghlUserEmail: input?.ghlUserEmail ?? undefined,
  };
}

async function holdPorts(hint?: {
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): Promise<{ ok: true; ports: QuoteHoldPorts } | { ok: false; error: string }> {
  const actor = await resolveHoldActor(actorHint(hint));
  if (!actor.ok) return actor;
  const releasedBy = actorHint({
    ghlUserId: actor.ghlUserId,
    ghlUserEmail: actor.ghlUserEmail,
  });

  const ports: QuoteHoldPorts = {
    createHold: async (input) => {
      const created = await createHold({
        variantId: input.variantId,
        sku: input.sku,
        qty: input.qty,
        ghlOpportunityId: input.opportunityId,
        note: input.note,
        ghlUserId: releasedBy.ghlUserId,
        ghlUserEmail: releasedBy.ghlUserEmail,
      });
      if (!created.ok) return created;
      return { ok: true, holdId: created.holdId };
    },
    releaseHold: async (holdId) => {
      const blocked = await legacyFabricReleaseError(holdId);
      if (blocked) return { ok: false, error: blocked };
      return releaseHold(holdId, releasedBy);
    },
  };
  return { ok: true, ports };
}

function revalidateQuoteSurfaces() {
  revalidatePath("/embed/order-desk");
}

const DISPATCH_FREIGHT_METHODS = new Set<FulfillmentMethod>([
  "LOCAL_WHITE_GLOVE",
  "INTERNAL_FLEET",
  "INTERNAL_FLEET_CURBSIDE",
  "INTERNAL_FLEET_WHITE_GLOVE",
  "INTERNAL_FLEET_FLAT_RATE",
  "PRIORITY1_LTL",
]);

/**
 * Save a dispatch selection onto an Order Desk draft without freezing the
 * GoHighLevel opportunity. Walk-ins with no opportunity get a new quote.
 */
export async function createDispatchEstimate(input: {
  opportunityId?: string | null;
  destZip: string;
  distanceMiles: number;
  method: FulfillmentMethod;
  label: string;
  freightUsd: number;
  variantSkus?: readonly string[];
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): Promise<
  | { ok: true; quoteId: string; opportunityId: string | null }
  | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to add this estimate." };

  const destZip = input.destZip.trim();
  if (!/^\d{5}$/.test(destZip)) return { ok: false, error: "Enter a 5-digit ZIP code." };
  if (!Number.isFinite(input.distanceMiles) || input.distanceMiles < 0) {
    return { ok: false, error: "Freight quote is missing a distance." };
  }
  if (!DISPATCH_FREIGHT_METHODS.has(input.method)) {
    return { ok: false, error: "Choose a freight option." };
  }
  if (!Number.isFinite(input.freightUsd) || input.freightUsd < 0) {
    return { ok: false, error: "The selected freight option has no customer total." };
  }
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Choose a freight option." };

  const actor = await resolveHoldActor({
    ghlUserId: input.ghlUserId,
    ghlUserEmail: input.ghlUserEmail,
  });
  if (!actor.ok) return { ok: false, error: actor.error };

  const opportunityId = input.opportunityId?.trim() ?? "";
  if (opportunityId) {
    const model = await loadOrderDesk({
      opportunityId,
      ghlUserId: input.ghlUserId,
      ghlUserEmail: input.ghlUserEmail,
    });
    if (model.state !== "quote") {
      return {
        ok: false,
        error: model.state === "error" ? model.message : "No opportunity is selected.",
      };
    }
    const stamped = await stampEstimateFreight({
      quoteId: model.quoteId,
      destZip,
      distanceMiles: input.distanceMiles,
      method: input.method,
      label,
      freightUsd: input.freightUsd,
    });
    if (!stamped.ok) return stamped;
    revalidateQuoteSurfaces();
    return { ok: true, quoteId: model.quoteId, opportunityId };
  }

  const created = await createWalkInDraft({
    actor,
    destZip,
    distanceMiles: input.distanceMiles,
    method: input.method,
    label,
    freightUsd: input.freightUsd,
    variantSkus: input.variantSkus ?? [],
  });
  if (!created.ok) return created;
  revalidateQuoteSurfaces();
  return { ok: true, quoteId: created.quoteId, opportunityId: null };
}

export async function openOrderDesk(input: {
  opportunityId: string;
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): Promise<OrderDeskModel> {
  return loadOrderDesk(input);
}

export async function saveOrderDeskDraft(
  input: {
    quoteId: string;
    version: number;
    opportunityId: string | null;
    ghlUserId?: string | null;
    ghlUserEmail?: string | null;
  } & QuoteCommercialInput,
): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to save this draft." };

  const actor = await resolveHoldActor({
    ghlUserId: input.ghlUserId,
    ghlUserEmail: input.ghlUserEmail,
  });
  if (!actor.ok) return { ok: false, error: actor.error };

  const commercial = parseQuoteCommercials(input);
  if (!commercial.ok) return commercial;

  const saved = await saveQuoteCommercials({
    quoteId: input.quoteId,
    version: input.version,
    patch: commercial.patch,
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

  const opportunityId = input.opportunityId?.trim() ?? "";
  if (!opportunityId) {
    revalidateQuoteSurfaces();
    return saved;
  }

  const refreshed = await refreshDraftSnapshot({
    quoteId: input.quoteId,
    version: saved.version,
    opportunityId,
  });
  if (!refreshed.ok) return refreshed;

  revalidateQuoteSurfaces();
  return refreshed;
}

export async function addCustomLine(input: {
  quoteId: string;
  expectedVersion: number;
  description: string;
  unitPrice: number;
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
  if (!session) return { ok: false, error: "Sign in to add a line." };

  const actor = await resolveHoldActor({
    ghlUserId: input.ghlUserId,
    ghlUserEmail: input.ghlUserEmail,
  });
  if (!actor.ok) return { ok: false, error: actor.error };

  const added = await addCustomQuoteLine({
    quoteId: input.quoteId,
    expectedVersion: input.expectedVersion,
    description: input.description,
    unitPrice: input.unitPrice,
  });
  if (added.ok) revalidateQuoteSurfaces();
  return added;
}

export async function searchOrderDeskProducts(
  query: string,
): Promise<{ ok: true; products: OrderDeskCatalogProduct[] } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to search products." };
  const products = await searchFinishedGoods(query);
  return { ok: true, products };
}

export async function removeQuoteLine(
  quoteId: string,
  lineId: string,
  expectedVersion: number,
  actorHintInput?: { ghlUserId?: string | null; ghlUserEmail?: string | null },
): Promise<QuoteHoldMutation> {
  const ready = await holdPorts(actorHintInput);
  if (!ready.ok) return ready;
  const result = await removeHeldQuoteLine(
    { quoteId, lineId, expectedVersion },
    ready.ports,
  );
  if (result.ok) revalidateQuoteSurfaces();
  return present(result);
}

export async function swapQuoteLine(
  quoteId: string,
  lineId: string,
  newSku: string,
  newVariantId: number,
  newQty: number,
  expectedVersion: number,
  actorHintInput?: { ghlUserId?: string | null; ghlUserEmail?: string | null },
): Promise<QuoteHoldMutation> {
  const ready = await holdPorts(actorHintInput);
  if (!ready.ok) return ready;
  const result = await swapHeldQuoteLine(
    {
      quoteId,
      lineId,
      newSku,
      newVariantId,
      newQty,
      expectedVersion,
    },
    ready.ports,
  );
  if (result.ok || result.error === "previous_hold_still_active") {
    revalidateQuoteSurfaces();
  }
  return present(result);
}

/** Retry after a swap whose old hold is still active. */
export async function releasePreviousHold(
  holdId: string,
  actorHintInput?: { ghlUserId?: string | null; ghlUserEmail?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ready = await holdPorts(actorHintInput);
  if (!ready.ok) return ready;
  const result = await ready.ports.releaseHold(holdId);
  if (result.ok) revalidateQuoteSurfaces();
  return result;
}

export type OrderDeskRatedQuote = Extract<RateQuoteFreightResult, { ok: true }> &
  Partial<
    Pick<
      CalculatedPromise,
      | "executedBy"
      | "promiseDate"
      | "calculatedPromiseDate"
      | "promiseTruckCode"
      | "promiseError"
    >
  >;

async function attachPromise(
  quoteId: string,
  rated: RateQuoteFreightResult,
  executedBy?: string | null,
): Promise<OrderDeskRatedQuote | { ok: false; error: string }> {
  if (!rated.ok) return rated;
  const promise = await calculatePromiseById(quoteId, { executedBy });
  if (!promise.ok) {
    return { ...rated, promiseError: promise.error };
  }
  return {
    ...rated,
    version: promise.version,
    executedBy: promise.executedBy,
    promiseDate: promise.promiseDate,
    calculatedPromiseDate: promise.calculatedPromiseDate,
    promiseTruckCode: promise.promiseTruckCode,
    promiseError: promise.promiseError,
  };
}

export async function rateQuoteFreight(
  quoteId: string,
  destZip?: string | null,
  executedBy?: string | null,
): Promise<OrderDeskRatedQuote | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to rate freight." };
  const rated = await rateQuoteById(quoteId, { destZip });
  const withPromise = await attachPromise(quoteId, rated, executedBy);
  revalidateQuoteSurfaces();
  return withPromise;
}

export async function calculatePromiseDate(
  quoteId: string,
  executedBy?: string | null,
): Promise<CalculatedPromise | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to estimate delivery." };
  const promise = await calculatePromiseById(quoteId, { executedBy });
  revalidateQuoteSurfaces();
  return promise;
}

export async function selectQuoteFreightMethod(
  quoteId: string,
  method: FulfillmentMethod,
): Promise<OrderDeskRatedQuote | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to rate freight." };
  const selected = await selectQuoteFreightMethodById(quoteId, method);
  const withPromise = await attachPromise(quoteId, selected);
  if (withPromise.ok) revalidateQuoteSurfaces();
  return withPromise;
}

export async function overrideQuoteFreight(input: {
  quoteId: string;
  expectedVersion: number;
  amount: number | null;
  reason: string;
}): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const actor = await requireCommercialOverride();
  if (!actor.ok) return actor;
  const saved = await overrideQuoteFreightTotal({ ...input, actor });
  if (saved.ok) revalidateQuoteSurfaces();
  return saved;
}

export async function overrideQuotePromise(input: {
  quoteId: string;
  expectedVersion: number;
  promiseDate: string | null;
  reason: string;
}): Promise<
  { ok: true; version: number; promiseDate: string | null } | { ok: false; error: string }
> {
  const actor = await requireCommercialOverride();
  if (!actor.ok) return actor;
  const saved = await overrideQuotePromiseDate({ ...input, actor });
  if (saved.ok) revalidateQuoteSurfaces();
  return saved;
}

function presentSendError(error: SendQuoteError | RevertQuoteError): string {
  switch (error) {
    case "stale_version":
      return "This draft was saved somewhere else. Reload to see the current version.";
    case "not_draft":
      return "This quote is no longer a draft.";
    case "not_sent":
      return "Only a sent quote can return to draft.";
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

export async function sendQuote(
  quoteId: string,
  expectedVersion: number,
  actorHintInput?: { ghlUserId?: string | null; ghlUserEmail?: string | null },
): Promise<
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

  const actor = await resolveHoldActor(actorHint(actorHintInput));
  if (!actor.ok) return { ok: false, error: actor.error };

  const frozen = await freezeQuote({
    quoteId,
    expectedVersion,
    actor,
  });
  if (!frozen.ok) return { ok: false, error: presentSendError(frozen.error) };

  revalidateQuoteSurfaces();
  return {
    ok: true,
    version: frozen.version,
    revisionId: frozen.revisionId,
    status: frozen.status,
    amountDue: frozen.amountDue,
    ghlSyncError: frozen.ghlSyncError,
  };
}

export async function revertToDraft(
  quoteId: string,
  expectedVersion: number,
): Promise<
  { ok: true; version: number; status: "draft" } | { ok: false; error: string }
> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to edit this quote." };

  const reverted = await revertQuoteToDraft({ quoteId, expectedVersion });
  if (!reverted.ok) return { ok: false, error: presentSendError(reverted.error) };

  revalidateQuoteSurfaces();
  return reverted;
}

export async function overrideQuoteMiles(input: {
  quoteId: string;
  expectedVersion: number;
  miles: number;
  reason: string;
}): Promise<RateQuoteFreightResult> {
  const actor = await requireCommercialOverride();
  if (!actor.ok) return actor;
  const rated = await overrideQuoteDistanceMiles({ ...input, actor });
  if (rated.ok) revalidateQuoteSurfaces();
  return rated;
}

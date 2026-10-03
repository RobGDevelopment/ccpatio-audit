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
import { loadOrderDesk, refreshDraftSnapshot } from "@/server/quotes/load-order-desk";
import {
  rateQuoteById,
  selectQuoteFreightMethodById,
  type RateQuoteFreightResult,
} from "@/server/quotes/rate-freight";
import type { CalculatedPromise } from "@/server/quotes/calculate-promise";
import type { OrderDeskModel } from "@/server/quotes/view";
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

export async function openOrderDesk(input: {
  opportunityId: string;
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): Promise<OrderDeskModel> {
  return loadOrderDesk(input);
}

export async function saveOrderDeskDraft(input: {
  quoteId: string;
  version: number;
  opportunityId: string;
  ghlUserId?: string | null;
  ghlUserEmail?: string | null;
}): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const session = await getPimSession();
  if (!session) return { ok: false, error: "Sign in to save this draft." };

  const actor = await resolveHoldActor({
    ghlUserId: input.ghlUserId,
    ghlUserEmail: input.ghlUserEmail,
  });
  if (!actor.ok) return { ok: false, error: actor.error };

  const saved = await refreshDraftSnapshot({
    quoteId: input.quoteId,
    version: input.version,
    opportunityId: input.opportunityId,
  });
  if (!saved.ok) return saved;

  revalidateQuoteSurfaces();
  return saved;
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

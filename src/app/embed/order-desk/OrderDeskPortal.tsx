"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { card, eyebrow } from "@/app/showroom/showroom-ui";
import {
  readActorFromHref,
  readOpportunityIdFromHref,
} from "@/lib/embed-actor-params";
import {
  openOrderDesk,
  overrideQuotePromise,
  rateQuoteFreight,
  releasePreviousHold,
  removeQuoteLine,
  revertToDraft,
  saveOrderDeskDraft,
  searchOrderDeskProducts,
  selectQuoteFreightMethod,
  sendQuote,
  swapQuoteLine,
  type OrderDeskCatalogProduct,
} from "@/server/actions/order-desk";
import type { OrderDeskLine, OrderDeskModel, OrderDeskQuote } from "@/server/quotes/view";
import type { FulfillmentMethod } from "@/types/freight";

const FREIGHT_DEBOUNCE_MS = 1500;

function money(amount: string | null): string {
  if (amount == null) return "—";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function qtyLabel(qty: string): string {
  const value = Number(qty);
  if (!Number.isFinite(value)) return qty;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function qtyInputValue(qty: string): string {
  const value = Number(qty);
  if (!Number.isFinite(value) || value <= 0) return "1";
  return String(value);
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function freightMethodLabel(method: string | null): string {
  switch (method) {
    case "LOCAL_WHITE_GLOVE":
      return "Local white-glove";
    case "INTERNAL_FLEET":
      return "Company truck";
    case "PRIORITY1_LTL":
      return "LTL";
    default:
      return "—";
  }
}

function applyFreight(current: OrderDeskQuote, result: {
  version: number;
  destZip: string | null;
  distanceMiles: string | null;
  merchandiseTotal: string | null;
  freightMethod: OrderDeskQuote["freightMethod"];
  freightTotal: string | null;
  freightError: string | null;
  freightOptions: OrderDeskQuote["freightOptions"];
  executedBy?: string;
  promiseDate?: string | null;
  calculatedPromiseDate?: string | null;
  promiseTruckCode?: string | null;
  promiseError?: string | null;
}): OrderDeskQuote {
  return {
    ...current,
    version: result.version,
    destZip: result.destZip,
    distanceMiles: result.distanceMiles,
    merchandiseTotal: result.merchandiseTotal,
    freightMethod: result.freightMethod,
    freightTotal: result.freightTotal,
    freightError: result.freightError,
    freightOptions: result.freightOptions,
    ...(result.executedBy !== undefined ? { executedBy: result.executedBy } : {}),
    ...(result.promiseDate !== undefined ? { promiseDate: result.promiseDate } : {}),
    ...(result.calculatedPromiseDate !== undefined
      ? { calculatedPromiseDate: result.calculatedPromiseDate }
      : {}),
    ...(result.promiseTruckCode !== undefined
      ? { promiseTruckCode: result.promiseTruckCode }
      : {}),
    ...(result.promiseError !== undefined ? { promiseError: result.promiseError } : {}),
  };
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function promiseErrorLabel(error: string | null): string | null {
  if (!error) return null;
  if (error === "no_zone") return "This ZIP has no delivery zone.";
  if (error === "no_capacity") return "No truck day has room for this shipment.";
  return error;
}

export function OrderDeskPortal({
  initial,
  ghlUserId,
  ghlUserEmail,
}: {
  initial: OrderDeskModel;
  ghlUserId?: string;
  ghlUserEmail?: string;
}) {
  const router = useRouter();
  const [model, setModel] = useState(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<
    "save" | "remove" | "swap" | "release" | "send" | "edit" | null
  >(null);
  const [searching, startSearch] = useTransition();
  const [removeLine, setRemoveLine] = useState<OrderDeskLine | null>(null);
  const [swapLineId, setSwapLineId] = useState<string | null>(null);
  const [swapQuery, setSwapQuery] = useState("");
  const [products, setProducts] = useState<OrderDeskCatalogProduct[]>([]);
  const [pendingProduct, setPendingProduct] = useState<OrderDeskCatalogProduct | null>(null);
  const [swapQty, setSwapQty] = useState("1");
  const [releaseAccepted, setReleaseAccepted] = useState(false);
  const [holdAccepted, setHoldAccepted] = useState(false);
  const [orphanHoldId, setOrphanHoldId] = useState<string | null>(null);
  const [zipDraft, setZipDraft] = useState(
    initial.state === "quote" ? initial.destZip ?? "" : "",
  );
  const [rating, setRating] = useState(false);
  const [executedDraft, setExecutedDraft] = useState(
    initial.state === "quote" ? initial.executedBy : "",
  );
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const zipQuoteId = useRef(initial.state === "quote" ? initial.quoteId : null);
  const executedQuoteId = useRef(initial.state === "quote" ? initial.quoteId : null);

  useEffect(() => {
    setModel(initial);
  }, [initial]);

  useEffect(() => {
    if (model.state !== "quote") return;
    if (zipQuoteId.current === model.quoteId) return;
    zipQuoteId.current = model.quoteId;
    setZipDraft(model.destZip ?? "");
  }, [model]);

  useEffect(() => {
    if (model.state !== "quote") return;
    if (executedQuoteId.current === model.quoteId) return;
    executedQuoteId.current = model.quoteId;
    setExecutedDraft(model.executedBy);
  }, [model]);

  useEffect(() => {
    if (initial.state !== "needs-opportunity") return;
    const opportunityId = readOpportunityIdFromHref(window.location.href);
    if (!opportunityId) return;
    const actor = readActorFromHref(window.location.href);
    startTransition(async () => {
      const next = await openOrderDesk({
        opportunityId,
        ghlUserId: actor.ghlUserId ?? ghlUserId,
        ghlUserEmail: actor.ghlUserEmail ?? ghlUserEmail,
      });
      setModel(next);
    });
  }, [ghlUserEmail, ghlUserId, initial]);

  useEffect(() => {
    if (!swapLineId) return;
    const query = swapQuery.trim();
    if (query.length < 2) {
      setProducts([]);
      return;
    }
    const handle = setTimeout(() => {
      startSearch(async () => {
        const result = await searchOrderDeskProducts(query);
        if (!result.ok) {
          setNotice(result.error);
          setProducts([]);
          return;
        }
        setProducts(result.products);
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [swapLineId, swapQuery]);

  const quoteId = model.state === "quote" ? model.quoteId : null;
  const quoteReadOnly = model.state === "quote" ? model.readOnly : true;
  const quoteStatus = model.state === "quote" ? model.status : null;
  const lineKey =
    model.state === "quote"
      ? model.lines.map((line) => `${line.id}:${line.sku}:${line.qty}`).join("|")
      : "";

  useEffect(() => {
    if (!quoteId || quoteReadOnly || quoteStatus !== "draft") return;
    const handle = window.setTimeout(() => {
      setRating(true);
      void rateQuoteFreight(quoteId, zipDraft, executedDraft)
        .then((result) => {
          if (!result.ok) {
            setNotice(result.error);
            return;
          }
          setModel((current) =>
            current.state === "quote" && current.quoteId === quoteId
              ? applyFreight(current, result)
              : current,
          );
        })
        .finally(() => setRating(false));
    }, FREIGHT_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [executedDraft, lineKey, quoteId, quoteReadOnly, quoteStatus, zipDraft]);

  function actorFromWindow() {
    const actor = readActorFromHref(window.location.href);
    return {
      ghlUserId: actor.ghlUserId ?? ghlUserId,
      ghlUserEmail: actor.ghlUserEmail ?? ghlUserEmail,
    };
  }

  function applyVersion(version: number) {
    setModel((current) =>
      current.state === "quote" ? { ...current, version } : current,
    );
  }

  function save() {
    if (model.state !== "quote" || model.readOnly) return;
    setNotice(null);
    setPendingAction("save");
    const actor = actorFromWindow();
    startTransition(async () => {
      try {
        const result = await saveOrderDeskDraft({
          quoteId: model.quoteId,
          version: model.version,
          opportunityId: model.opportunityId,
          ghlUserId: actor.ghlUserId,
          ghlUserEmail: actor.ghlUserEmail,
        });
        if (!result.ok) {
          setNotice(result.error);
          return;
        }
        setNotice("Draft saved.");
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  function confirmRemove() {
    if (model.state !== "quote" || !removeLine) return;
    const line = removeLine;
    setNotice(null);
    setPendingAction("remove");
    const actor = actorFromWindow();
    startTransition(async () => {
      try {
        const result = await removeQuoteLine(
          model.quoteId,
          line.id,
          model.version,
          actor,
        );
        if (!result.ok) {
          setNotice(result.error);
          if (result.version) applyVersion(result.version);
          return;
        }
        setRemoveLine(null);
        setModel((current) => {
          if (current.state !== "quote") return current;
          return {
            ...current,
            version: result.version,
            lines: current.lines.filter((item) => item.id !== line.id),
          };
        });
        setNotice("Line removed.");
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  function chooseProduct(product: OrderDeskCatalogProduct) {
    if (model.state !== "quote") return;
    const line = model.lines.find((item) => item.id === swapLineId);
    setSwapQty(line ? qtyInputValue(line.qty) : "1");
    setReleaseAccepted(false);
    setHoldAccepted(false);
    setPendingProduct(product);
  }

  function confirmSwap() {
    if (model.state !== "quote" || !swapLineId || !pendingProduct) return;
    if (!releaseAccepted || !holdAccepted) return;
    const qty = Number(swapQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setNotice("Quantity must be greater than 0.");
      return;
    }
    const lineId = swapLineId;
    const product = pendingProduct;
    setNotice(null);
    setPendingAction("swap");
    const actor = actorFromWindow();
    startTransition(async () => {
      try {
      const result = await swapQuoteLine(
        model.quoteId,
        lineId,
        product.sku,
        product.variantId,
        qty,
        model.version,
        actor,
      );
      if (!result.ok && result.error === "previous_hold_still_active") {
        setOrphanHoldId(result.previousHoldId ?? null);
        setNotice(
          "The new item is held on this line. The previous hold is still active.",
        );
        if (result.version) applyVersion(result.version);
        setPendingProduct(null);
        setSwapLineId(null);
        router.refresh();
        return;
      }
      if (!result.ok) {
        setNotice(result.error);
        if (result.version) applyVersion(result.version);
        return;
      }
      applyVersion(result.version);
      setPendingProduct(null);
      setSwapLineId(null);
      setNotice("Line updated.");
      router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  function savePromiseOverride() {
    if (model.state !== "quote" || model.readOnly) return;
    setNotice(null);
    startTransition(async () => {
      const result = await overrideQuotePromise({
        quoteId: model.quoteId,
        expectedVersion: model.version,
        promiseDate: overrideDate.trim() || null,
        reason: overrideReason,
      });
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setModel((current) =>
        current.state === "quote"
          ? { ...current, version: result.version, promiseDate: result.promiseDate }
          : current,
      );
      setOverrideReason("");
      setNotice("Delivery date updated.");
    });
  }

  function chooseFreight(method: FulfillmentMethod) {
    if (model.state !== "quote" || model.readOnly) return;
    setNotice(null);
    startTransition(async () => {
      const result = await selectQuoteFreightMethod(model.quoteId, method);
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setModel((current) =>
        current.state === "quote" ? applyFreight(current, result) : current,
      );
    });
  }

  function freezeProposal() {
    if (model.state !== "quote" || model.readOnly || model.status !== "draft") return;
    setNotice(null);
    setPendingAction("send");
    const actor = actorFromWindow();
    startTransition(async () => {
      try {
        const result = await sendQuote(model.quoteId, model.version, actor);
        if (!result.ok) {
          setNotice(result.error);
          return;
        }
        setSwapLineId(null);
        setRemoveLine(null);
        setPendingProduct(null);
        setModel((current) =>
          current.state === "quote"
            ? {
                ...current,
                status: "sent",
                readOnly: true,
                version: result.version,
                ghlSyncError: result.ghlSyncError,
              }
            : current,
        );
        setNotice(
          result.ghlSyncError
            ? `Quote frozen. GoHighLevel was not updated. ${result.ghlSyncError}`
            : "Quote Frozen. GHL Opportunity Updated.",
        );
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  function editSentQuote() {
    if (model.state !== "quote" || model.status !== "sent") return;
    setNotice(null);
    setPendingAction("edit");
    startTransition(async () => {
      try {
        const result = await revertToDraft(model.quoteId, model.version);
        if (!result.ok) {
          setNotice(result.error);
          return;
        }
        setModel((current) =>
          current.state === "quote"
            ? {
                ...current,
                status: "draft",
                readOnly: current.closedOpportunity,
                version: result.version,
                ghlSyncError: null,
              }
            : current,
        );
        setNotice("Quote returned to draft.");
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  function retryPreviousHold() {
    if (!orphanHoldId) return;
    const holdId = orphanHoldId;
    setNotice(null);
    setPendingAction("release");
    const actor = actorFromWindow();
    startTransition(async () => {
      try {
        const result = await releasePreviousHold(holdId, actor);
        if (!result.ok) {
          setNotice(result.error);
          return;
        }
        setOrphanHoldId(null);
        setNotice("Previous hold released.");
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  const swapLine =
    model.state === "quote" ? model.lines.find((line) => line.id === swapLineId) : undefined;

  const quote = model.state === "quote" ? model : null;
  const canSwitchFreight = Boolean(
    quote &&
      !quote.readOnly &&
      quote.freightOptions.some((option) => option.method === "INTERNAL_FLEET") &&
      quote.freightOptions.some((option) => option.method === "PRIORITY1_LTL"),
  );
  const canSend = Boolean(
    quote &&
      quote.status === "draft" &&
      !quote.readOnly &&
      quote.lines.length > 0 &&
      quote.merchandiseTotal != null &&
      quote.freightTotal != null &&
      quote.promiseDate &&
      /^\d{5}$/.test(quote.destZip ?? ""),
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className={eyebrow}>Order Desk</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {model.state === "quote" ? model.opportunityName : "Draft"}
          </h1>
        </div>
        {model.state === "quote" ? (
          <p
            data-testid="order-desk-status"
            className="rounded-full bg-white px-3 py-1 text-xs font-medium uppercase tracking-widest text-slate-600 ring-1 ring-slate-200"
          >
            {statusLabel(model.status)}
          </p>
        ) : null}
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex flex-col gap-4">
      {model.state === "needs-opportunity" ? (
        <section data-testid="order-desk-empty" className={`${card} px-5 py-8`}>
          <p className="text-sm text-slate-700">
            No opportunity is selected. Open Order Desk from a GoHighLevel
            opportunity to start a draft. Active showroom holds on that
            opportunity are added as lines.
          </p>
        </section>
      ) : null}

      {model.state === "error" ? (
        <section role="alert" data-testid="order-desk-error" className={`${card} px-5 py-6`}>
          <p className="text-sm font-medium text-rose-700">{model.message}</p>
        </section>
      ) : null}

      {model.state === "quote" ? (
        <section data-testid="order-desk-draft" className={`${card} px-5 py-5`}>
          {model.closedOpportunity ? (
            <p className="mb-4 text-sm text-amber-800" role="status">
              This opportunity is closed. The draft is read only.
            </p>
          ) : null}
          {model.voidReason ? (
            <p className="mb-4 text-sm text-slate-600">
              Closed because the opportunity was {model.voidReason}.
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">
                <label htmlFor="order-desk-dest-zip">Destination ZIP</label>
              </dt>
              <dd className="font-medium text-slate-900">
                {model.readOnly ? (
                  model.destZip ?? "—"
                ) : (
                  <input
                    id="order-desk-dest-zip"
                    data-testid="order-desk-dest-zip"
                    value={zipDraft}
                    onChange={(event) =>
                      setZipDraft(event.target.value.replace(/\D/g, "").slice(0, 5))
                    }
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={5}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                )}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Merchandise</dt>
              <dd className="font-medium text-slate-900" data-testid="order-desk-total">
                {money(model.merchandiseTotal)}
              </dd>
            </div>
          </dl>

          {model.lines.length === 0 ? (
            <p data-testid="order-desk-no-lines" className="mt-6 text-sm text-slate-600">
              This draft has no lines. An active showroom hold on this
              opportunity is added when the draft is first created.
            </p>
          ) : (
            <ul data-testid="order-desk-lines" className="mt-6 divide-y divide-slate-100">
              {model.lines.map((line) => (
                <li key={line.id} className="py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{line.description}</p>
                      <p className="text-xs text-slate-500">
                        {line.sku} · Qty {qtyLabel(line.qty)}
                      </p>
                      {line.priceError ? (
                        <p className="mt-1 text-xs text-amber-800">{line.priceError}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900">{money(line.unitPrice)}</p>
                      {model.readOnly ? null : (
                        <>
                          {line.holdId ? (
                            <button
                              type="button"
                              data-testid={`order-desk-replace-${line.id}`}
                              onClick={() => {
                                setNotice(null);
                                setPendingProduct(null);
                                setSwapQuery("");
                                setProducts([]);
                                setSwapLineId((current) => (current === line.id ? null : line.id));
                              }}
                              disabled={pending}
                              className="rounded-full px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
                            >
                              Replace
                            </button>
                          ) : null}
                          <button
                            type="button"
                            aria-label={`Remove ${line.sku}`}
                            data-testid={`order-desk-remove-${line.id}`}
                            onClick={() => {
                              setNotice(null);
                              setRemoveLine(line);
                            }}
                            disabled={pending}
                            className="rounded-full p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {swapLineId === line.id ? (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3" data-testid="order-desk-swap-search">
                      <label className="block text-xs text-slate-500" htmlFor={`swap-${line.id}`}>
                        Replacement product
                      </label>
                      <input
                        id={`swap-${line.id}`}
                        value={swapQuery}
                        onChange={(event) => setSwapQuery(event.target.value)}
                        placeholder="Search SKU or name"
                        autoComplete="off"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                      />
                      {searching ? (
                        <p className="mt-2 text-xs text-slate-500">Searching catalog…</p>
                      ) : null}
                      {products.length > 0 ? (
                        <ul className="mt-2 divide-y divide-slate-200">
                          {products.map((product) => (
                            <li key={product.sku}>
                              <button
                                type="button"
                                data-testid={`order-desk-product-${product.sku}`}
                                onClick={() => chooseProduct(product)}
                                className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-slate-950"
                              >
                                <span>
                                  <span className="font-medium text-slate-900">{product.name}</span>
                                  <span className="mt-0.5 block text-xs text-slate-500">{product.sku}</span>
                                </span>
                                <span className="text-slate-700">{money(product.unitPrice)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {orphanHoldId ? (
            <div
              data-testid="order-desk-orphan-hold"
              className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
              role="status"
            >
              <p className="text-sm text-amber-950">
                The new item is on this line. The previous hold is still active.
              </p>
              <button
                type="button"
                data-testid="order-desk-retry-release"
                onClick={retryPreviousHold}
                disabled={pending}
                className="mt-3 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {pendingAction === "release" ? "Releasing…" : "Release previous hold"}
              </button>
            </div>
          ) : null}

          {model.suggestions.length > 0 ? (
            <div data-testid="order-desk-suggestions" className="mt-6 border-t border-slate-100 pt-4">
              <p className={eyebrow}>Holds not on this draft</p>
              <ul className="mt-3 space-y-2">
                {model.suggestions.map((hold) => (
                  <li key={hold.holdId} className="text-sm text-slate-700">
                    {hold.sku} · Qty {qtyLabel(hold.qty)}
                    <span className="block text-xs text-slate-500">{hold.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {notice ? (
            <p role="status" data-testid="order-desk-notice" className="mt-4 text-sm text-slate-700">
              {notice}
            </p>
          ) : null}

          {model.readOnly ? null : (
            <button
              type="button"
              data-testid="order-desk-save"
              onClick={save}
              disabled={pending}
              className="mt-5 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {pendingAction === "save" ? "Saving…" : "Save draft"}
            </button>
          )}
        </section>
      ) : null}
      </div>

      {quote ? (
        <aside
          data-testid="order-desk-invoice"
          className={`${card} h-fit px-5 py-5 lg:sticky lg:top-4`}
        >
          <p className={eyebrow}>Invoice Summary</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-slate-500">Freight method</dt>
              <dd className="font-medium text-slate-900" data-testid="order-desk-freight-method">
                {freightMethodLabel(quote.freightMethod)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Freight</dt>
              <dd className="font-medium text-slate-900" data-testid="order-desk-freight-total">
                {money(quote.freightTotal)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Merchandise</dt>
              <dd className="font-medium text-slate-900">{money(quote.merchandiseTotal)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Estimated delivery</dt>
              <dd className="font-medium text-slate-900" data-testid="order-desk-promise-date">
                {dateLabel(quote.promiseDate)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500" data-testid="order-desk-promise-copy">
            Estimated delivery date if executed by {dateLabel(executedDraft || quote.executedBy)}.
          </p>
          {quote.readOnly ? null : (
            <label className="mt-3 block text-xs text-slate-500" htmlFor="order-desk-executed-by">
              If executed by
              <input
                id="order-desk-executed-by"
                data-testid="order-desk-executed-by"
                type="date"
                value={executedDraft}
                onChange={(event) => setExecutedDraft(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              />
            </label>
          )}
          {quote.promiseTruckCode ? (
            <p className="mt-2 text-xs text-slate-500">Truck {quote.promiseTruckCode}</p>
          ) : null}
          {promiseErrorLabel(quote.promiseError) ? (
            <p className="mt-3 text-sm text-rose-700" role="status" data-testid="order-desk-promise-error">
              {promiseErrorLabel(quote.promiseError)}
            </p>
          ) : null}
          {quote.readOnly ? null : (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500">Manager date override</p>
              <label className="mt-2 block text-xs text-slate-500" htmlFor="order-desk-promise-override">
                Delivery date
                <input
                  id="order-desk-promise-override"
                  data-testid="order-desk-promise-override"
                  type="date"
                  value={overrideDate}
                  onChange={(event) => setOverrideDate(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </label>
              <label className="mt-2 block text-xs text-slate-500" htmlFor="order-desk-promise-reason">
                Reason
                <input
                  id="order-desk-promise-reason"
                  data-testid="order-desk-promise-reason"
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </label>
              <button
                type="button"
                data-testid="order-desk-promise-save"
                onClick={savePromiseOverride}
                disabled={pending}
                className="mt-3 rounded-full px-3 py-2 text-xs font-medium text-slate-800 ring-1 ring-slate-200 disabled:opacity-60"
              >
                Save override
              </button>
            </div>
          )}
          {quote.distanceMiles ? (
            <p className="mt-3 text-xs text-slate-500">
              {Number(quote.distanceMiles).toLocaleString("en-US")} miles from the dock
            </p>
          ) : null}
          {rating ? (
            <p className="mt-3 text-xs text-slate-500" role="status">
              Rating freight…
            </p>
          ) : null}
          {quote.freightError ? (
            <p
              className="mt-3 text-sm text-rose-700"
              role="status"
              data-testid="order-desk-freight-error"
            >
              {quote.freightError}
            </p>
          ) : null}
          {quote.status === "sent" && !quote.ghlSyncError ? (
            <p
              className="mt-4 text-sm font-medium text-blue-800"
              role="status"
              data-testid="order-desk-frozen"
            >
              Quote Frozen. GHL Opportunity Updated.
            </p>
          ) : null}
          {quote.ghlSyncError ? (
            <p className="mt-4 text-sm text-rose-700" role="status" data-testid="order-desk-ghl-sync-error">
              Quote frozen. GoHighLevel was not updated. {quote.ghlSyncError}
            </p>
          ) : null}
          {quote.status === "draft" ? (
            <div className="mt-5">
              <button
                type="button"
                data-testid="order-desk-send"
                onClick={freezeProposal}
                disabled={!canSend || pending}
                className="w-full rounded-xl bg-blue-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pendingAction === "send" ? "Sending…" : "Freeze & Send Proposal"}
              </button>
              {canSend ? null : (
                <p className="mt-2 text-xs text-slate-500">
                  A priced line, freight, a delivery date, and a five-digit ZIP are required.
                </p>
              )}
            </div>
          ) : null}
          {quote.status === "sent" && !quote.closedOpportunity ? (
            <button
              type="button"
              data-testid="order-desk-edit"
              onClick={editSentQuote}
              disabled={pending}
              className="mt-3 w-full rounded-xl px-4 py-3 text-base font-semibold text-slate-800 ring-1 ring-slate-200 disabled:opacity-60"
            >
              {pendingAction === "edit" ? "Returning to draft…" : "Edit Quote"}
            </button>
          ) : null}
          {canSwitchFreight ? (
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                data-testid="order-desk-freight-fleet"
                onClick={() => chooseFreight("INTERNAL_FLEET")}
                disabled={pending}
                className="rounded-full px-3 py-2 text-xs font-medium text-slate-800 ring-1 ring-slate-200 disabled:opacity-60"
              >
                Use company truck
              </button>
              <button
                type="button"
                data-testid="order-desk-freight-ltl"
                onClick={() => chooseFreight("PRIORITY1_LTL")}
                disabled={pending}
                className="rounded-full px-3 py-2 text-xs font-medium text-slate-800 ring-1 ring-slate-200 disabled:opacity-60"
              >
                Use LTL
              </button>
            </div>
          ) : null}
        </aside>
      ) : null}
      </div>

      {removeLine ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-desk-remove-title"
          data-testid="order-desk-remove-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
        >
          <div className={`${card} w-full max-w-md px-5 py-5`}>
            <h2 id="order-desk-remove-title" className="text-base font-semibold text-slate-900">
              {removeLine.holdId ? "Release the previous hold?" : "Remove this line?"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {removeLine.sku} · Qty {qtyLabel(removeLine.qty)}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveLine(null)}
                disabled={pending}
                className="rounded-full px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="order-desk-remove-confirm"
                onClick={confirmRemove}
                disabled={pending}
                className="rounded-full bg-rose-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {pendingAction === "remove"
                  ? "Removing…"
                  : removeLine.holdId
                    ? "Release hold and remove line"
                    : "Remove line"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingProduct && swapLine ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-desk-swap-title"
          data-testid="order-desk-swap-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
        >
          <div className={`${card} w-full max-w-md px-5 py-5`}>
            <h2 id="order-desk-swap-title" className="text-base font-semibold text-slate-900">
              Release previous hold and hold new item from inventory?
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {swapLine.sku} becomes {pendingProduct.sku}. Both answers are required.
            </p>
            <label className="mt-4 block text-xs text-slate-500" htmlFor="order-desk-swap-qty">
              Quantity
            </label>
            <input
              id="order-desk-swap-qty"
              data-testid="order-desk-swap-qty"
              value={swapQty}
              onChange={(event) => setSwapQty(event.target.value)}
              inputMode="decimal"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <label className="mt-4 flex items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                data-testid="order-desk-accept-release"
                checked={releaseAccepted}
                onChange={(event) => setReleaseAccepted(event.target.checked)}
              />
              Release the previous hold
            </label>
            <label className="mt-2 flex items-start gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                data-testid="order-desk-accept-hold"
                checked={holdAccepted}
                onChange={(event) => setHoldAccepted(event.target.checked)}
              />
              Hold the new item from inventory
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingProduct(null)}
                disabled={pending}
                className="rounded-full px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="order-desk-swap-confirm"
                onClick={confirmSwap}
                disabled={pending || !releaseAccepted || !holdAccepted}
                className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {pendingAction === "swap" ? "Holding…" : "Hold new item"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Lock, Plus, Search, Trash2, Unlock, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { card, eyebrow } from "@/app/showroom/showroom-ui";
import {
  orderDeskPathForCustomer,
  orderDeskSearchPathFromHref,
  readActorFromHref,
  readOpportunityIdFromHref,
} from "@/lib/embed-actor-params";
import { lineExtended } from "@/lib/quote-financials";
import {
  generateQuotePackage,
  generateQuotePdf,
  getQuotePackageReadiness,
} from "@/server/actions/generatePdf";
import type { ReadinessEntry } from "@/server/quotes/package-specs";
import {
  addCustomLine,
  openOrderDesk,
  overrideQuotePromise,
  rateQuoteFreight,
  releasePreviousHold,
  removeQuoteLine,
  revertToDraft,
  searchOrderDeskProducts,
  selectQuoteFreightMethod,
  swapQuoteLine,
  type OrderDeskCatalogProduct,
} from "@/server/actions/order-desk";
import {
  addCatalogFurnitureLine,
  finalizeAndSyncQuoteToGhl,
  searchGhlCustomers,
  upsertQuoteDraft,
  type GhlCustomerHit,
} from "@/server/actions/quote";
import type { OrderDeskLine, OrderDeskModel, OrderDeskQuote } from "@/server/quotes/view";
import { selectQuoteFinancials, useQuoteStore } from "@/store/useQuoteStore";
import type { FulfillmentMethod } from "@/types/freight";

const FREIGHT_DEBOUNCE_MS = 1500;
const CUSTOMER_SEARCH_DEBOUNCE_MS = 300;

/** "+14805551212" becomes "(480) 555-1212". Anything that is not a US number is shown as typed. */
function phoneLabel(phone: string | null | undefined): string {
  const raw = phone?.trim() ?? "";
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return raw;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/**
 * The page shown when Order Desk opens with no customer. A rep types a name, email, or phone
 * number, picks a match, and the quote opens exactly as it does from a customer card in the CRM.
 * It renders inline in the page (no popovers or fixed layers), so it works inside the iframe.
 */
function CustomerSearchHub({
  onSelect,
  busyOpportunityId,
}: {
  onSelect: (hit: GhlCustomerHit) => void;
  busyOpportunityId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GhlCustomerHit[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setError(null);
      setStatus("idle");
      return;
    }
    // `cancelled` drops the answer of any search that a newer keystroke has replaced.
    let cancelled = false;
    setStatus("searching");
    const handle = window.setTimeout(() => {
      searchGhlCustomers(term)
        .then((result) => {
          if (cancelled) return;
          if (!result.ok) {
            setResults([]);
            setError(result.error);
            setStatus("error");
            return;
          }
          setError(null);
          setResults(result.results);
          setStatus("done");
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setError("Search is not available right now. Please try again.");
          setStatus("error");
        });
    }, CUSTOMER_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  const busy = busyOpportunityId !== null;

  return (
    <div
      data-testid="order-desk-customer-search"
      className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-4 py-10 sm:px-6"
    >
      <section className={`${card} px-6 py-8 sm:px-8`}>
        <p className={eyebrow}>Order Desk</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          Search for a Customer
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Type a name, email address, or phone number to start a quote.
        </p>

        <div className="relative mt-6">
          <Search
            className="pointer-events-none absolute top-3.5 left-3.5 h-4 w-4 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            data-testid="customer-search-input"
            aria-label="Search for a customer"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, email, or phone number"
            autoComplete="off"
            autoFocus
            disabled={busy}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pr-4 pl-10 text-sm text-slate-900 outline-none focus:border-slate-900 focus:bg-white disabled:opacity-60"
          />
        </div>

        <div className="mt-4" aria-live="polite">
          {status === "idle" ? (
            <p className="py-6 text-center text-sm text-slate-500">
              Start typing to see matching customers.
            </p>
          ) : null}
          {status === "searching" ? (
            <p data-testid="customer-search-loading" className="py-6 text-center text-sm text-slate-500">
              Searching…
            </p>
          ) : null}
          {status === "error" ? (
            <p
              role="alert"
              data-testid="customer-search-error"
              className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700"
            >
              {error ?? "Search is not available right now. Please try again."}
            </p>
          ) : null}
          {status === "done" && results.length === 0 ? (
            <p data-testid="customer-search-empty" className="py-6 text-center text-sm text-slate-500">
              No customers found. Check the spelling or try an email address or phone number.
            </p>
          ) : null}
          {status === "done" && results.length > 0 ? (
            <ul
              data-testid="customer-search-results"
              className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-100"
            >
              {results.map((hit) => {
                const key = hit.opportunityId ?? `contact-${hit.contactId}`;
                const contactLine = [hit.email, phoneLabel(hit.phone)].filter(Boolean).join(" · ");
                const opening = busyOpportunityId !== null && busyOpportunityId === hit.opportunityId;
                return (
                  <li
                    key={key}
                    data-testid={`customer-search-result-${key}`}
                    className="flex items-center justify-between gap-4 px-4 py-3.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{hit.name}</p>
                      {contactLine ? (
                        <p className="mt-0.5 truncate text-xs text-slate-500">{contactLine}</p>
                      ) : null}
                      {hit.opportunityName && hit.opportunityName !== hit.name ? (
                        <p className="mt-0.5 truncate text-xs text-slate-400">{hit.opportunityName}</p>
                      ) : null}
                      {hit.opportunityId ? null : (
                        <p className="mt-0.5 text-xs text-amber-800">
                          No open order yet. Add one in GoHighLevel first.
                        </p>
                      )}
                    </div>
                    {hit.opportunityId ? (
                      <button
                        type="button"
                        data-testid={`customer-search-select-${key}`}
                        onClick={() => onSelect(hit)}
                        disabled={busy}
                        className="shrink-0 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        {opening ? "Starting quote…" : "Select"}
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function money(amount: string | null): string {
  if (amount == null || amount.trim() === "") return "—";
  const value = Number(amount);
  if (!Number.isFinite(value)) return "—";
  return moneyNumber(value);
}

function moneyNumber(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function savePdfFile(pdfBase64: string, filename: string) {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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

function freightMethodLabel(method: string | null, carrier: string | null): string {
  switch (method) {
    case "LOCAL_WHITE_GLOVE":
      return "Local white-glove";
    case "INTERNAL_FLEET":
      return "Company truck";
    case "INTERNAL_FLEET_CURBSIDE":
      return "CC Patio Fleet Curbside";
    case "INTERNAL_FLEET_WHITE_GLOVE":
      return "CC Patio Fleet White Glove";
    case "INTERNAL_FLEET_FLAT_RATE":
      return "CC Patio Fleet Admin Flat Rate";
    case "PRIORITY1_LTL":
      return carrier ? `LTL - ${carrier}` : "LTL";
    default:
      return "—";
  }
}

function applyFreight(
  current: OrderDeskQuote,
  result: {
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
  },
): OrderDeskQuote {
  return {
    ...current,
    version: result.version,
    destZip: result.destZip,
    distanceMiles: result.distanceMiles,
    merchandiseTotal: result.merchandiseTotal,
    freightMethod: result.freightMethod,
    freightTotal: result.freightTotal,
    selectedCarrierCode:
      result.freightMethod === current.freightMethod ? current.selectedCarrierCode : null,
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
  const store = useQuoteStore();
  const hydratedRef = useRef<OrderDeskModel | null>(null);
  if (hydratedRef.current !== initial) {
    hydratedRef.current = initial;
  }

  useEffect(() => {
    store.hydrateModel(initial);
  }, [initial]);

  const model = store.quoteId || store.model.state !== "needs-opportunity" ? store.model : initial;
  const lineItems =
    store.quoteId === (initial.state === "quote" ? initial.quoteId : null) && store.lineItems.length > 0
      ? store.lineItems
      : initial.state === "quote"
        ? initial.lines.map((line) => ({
            ...line,
            defaultUnitPrice: line.unitPrice,
            priceOverridden: false,
          }))
        : [];

  const customerName =
    store.quoteId === (initial.state === "quote" ? initial.quoteId : null)
      ? store.customerName
      : initial.state === "quote"
        ? initial.customerName ?? ""
        : "";
  const customerEmail =
    store.quoteId === (initial.state === "quote" ? initial.quoteId : null)
      ? store.customerEmail
      : initial.state === "quote"
        ? initial.customerEmail ?? ""
        : "";
  const billToAddress =
    store.quoteId === (initial.state === "quote" ? initial.quoteId : null)
      ? store.billToAddress
      : initial.state === "quote"
        ? initial.billToAddress ?? ""
        : "";
  const shipToAddress =
    store.quoteId === (initial.state === "quote" ? initial.quoteId : null)
      ? store.shipToAddress
      : initial.state === "quote"
        ? initial.shipToAddress ?? ""
        : "";
  const zipDraft =
    store.quoteId === (initial.state === "quote" ? initial.quoteId : null)
      ? store.destZip
      : initial.state === "quote"
        ? initial.destZip ?? ""
        : "";
  const executedDraft =
    store.quoteId === (initial.state === "quote" ? initial.quoteId : null)
      ? store.executedBy
      : initial.state === "quote"
        ? initial.executedBy
        : "";
  const discountDraft =
    store.quoteId === (initial.state === "quote" ? initial.quoteId : null)
      ? store.discountAmount
      : initial.state === "quote"
        ? String(Number(initial.discountAmount) || 0)
        : "0";
  const discountType =
    store.quoteId === (initial.state === "quote" ? initial.quoteId : null)
      ? store.discountType
      : initial.state === "quote"
        ? initial.discountType
        : "FLAT";
  const taxDraft =
    store.quoteId === (initial.state === "quote" ? initial.quoteId : null)
      ? store.taxAmount
      : initial.state === "quote"
        ? String(Number(initial.taxAmount) || 0)
        : "0";

  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** The customer picked in the search hub. Drives the "Starting quote…" state until the quote opens. */
  const [selection, setSelection] = useState<{ opportunityId: string; contactId: string } | null>(
    null,
  );
  const [pendingAction, setPendingAction] = useState<
    "save" | "remove" | "swap" | "release" | "send" | "edit" | "custom" | "add" | "pdf" | "package" | null
  >(null);

  // Add Furniture Full-Screen Takeover Modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [furnitureQuery, setFurnitureQuery] = useState("");
  const [furnitureResults, setFurnitureResults] = useState<OrderDeskCatalogProduct[]>([]);
  const [searchingFurniture, startFurnitureSearch] = useTransition();

  // Custom Item Inline Drawer
  const [customOpen, setCustomOpen] = useState(false);
  const [customDescription, setCustomDescription] = useState("");
  const [customPrice, setCustomPrice] = useState("");

  // Swap / Remove Hold Modals
  const [searching, startSearch] = useTransition();
  const [removeLineState, setRemoveLineState] = useState<OrderDeskLine | null>(null);
  const [swapLineId, setSwapLineId] = useState<string | null>(null);
  const [swapQuery, setSwapQuery] = useState("");
  const [products, setProducts] = useState<OrderDeskCatalogProduct[]>([]);
  const [pendingProduct, setPendingProduct] = useState<OrderDeskCatalogProduct | null>(null);
  const [swapQty, setSwapQty] = useState("1");
  const [releaseAccepted, setReleaseAccepted] = useState(false);
  const [holdAccepted, setHoldAccepted] = useState(false);
  const [orphanHoldId, setOrphanHoldId] = useState<string | null>(null);

  const [rating, setRating] = useState(false);
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [readiness, setReadiness] = useState<ReadinessEntry[] | null>(null);
  const [readinessError, setReadinessError] = useState<string | null>(null);

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
      store.hydrateModel(next);
    });
  }, [ghlUserEmail, ghlUserId, initial]);

  // Search inside Add Furniture Takeover Modal
  useEffect(() => {
    if (!addModalOpen) return;
    const query = furnitureQuery.trim();
    if (query.length < 2) {
      setFurnitureResults([]);
      return;
    }
    const handle = setTimeout(() => {
      startFurnitureSearch(async () => {
        const result = await searchOrderDeskProducts(query);
        if (!result.ok) {
          setNotice(result.error);
          setFurnitureResults([]);
          return;
        }
        setFurnitureResults(result.products);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [addModalOpen, furnitureQuery]);

  // Search inside Replace Hold Inline Box
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
  const lineKey = lineItems.map((line) => `${line.id}:${line.sku}:${line.qty}`).join("|");

  // Package readiness pre-flight
  useEffect(() => {
    if (!quoteId) return;
    let cancelled = false;
    void (async () => {
      const result = await getQuotePackageReadiness(quoteId);
      if (cancelled) return;
      if (!result.ok) {
        setReadiness(null);
        setReadinessError(result.error);
        return;
      }
      setReadinessError(null);
      setReadiness(result.entries);
    })();
    return () => {
      cancelled = true;
    };
  }, [quoteId, lineKey]);

  const preservedFreight = useRef(
    initial.state === "quote" && initial.freightTotal != null && initial.freightMethod != null
      ? {
          quoteId: initial.quoteId,
          lineKey: initial.lines.map((line) => `${line.id}:${line.sku}:${line.qty}`).join("|"),
          zip: initial.destZip ?? "",
        }
      : null,
  );

  useEffect(() => {
    if (!quoteId || quoteReadOnly || quoteStatus !== "draft") return;
    const preserved = preservedFreight.current;
    if (
      preserved &&
      preserved.quoteId === quoteId &&
      preserved.lineKey === lineKey &&
      preserved.zip === zipDraft.trim()
    ) {
      return;
    }
    const handle = window.setTimeout(() => {
      setRating(true);
      void rateQuoteFreight(quoteId, zipDraft, executedDraft)
        .then((result) => {
          if (!result.ok) {
            setNotice(result.error);
            return;
          }
          store.patchQuoteState((current) =>
            current.quoteId === quoteId ? applyFreight(current, result) : current,
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

  /**
   * Opens the quote for a customer picked in the search hub. The page URL gains the same
   * opportunityId and contactId a CRM link carries, so the server loads, syncs, and hydrates the
   * quote on the one path every other entry uses, and a reload or save lands on the same quote.
   */
  function startQuote(hit: GhlCustomerHit) {
    if (!hit.opportunityId) return;
    setSelection({ opportunityId: hit.opportunityId, contactId: hit.contactId });
    startTransition(() => {
      router.replace(
        orderDeskPathForCustomer(window.location.href, {
          opportunityId: hit.opportunityId ?? "",
          contactId: hit.contactId,
        }),
      );
    });
  }

  function searchForAnotherCustomer() {
    setNotice(null);
    setSelection(null);
    startTransition(() => {
      router.replace(orderDeskSearchPathFromHref(window.location.href));
    });
  }

  function commercialInput() {
    return {
      customerName,
      customerEmail,
      billToAddress,
      shipToAddress,
      discountAmount: discountDraft,
      discountType,
      taxAmount: taxDraft,
      depositPct: store.depositPct,
      shippingCost: store.shippingCost !== "" ? store.shippingCost : quote?.freightTotal ?? null,
      lines: lineItems.map((item) => ({
        id: item.id,
        qty: item.qty,
        unitPrice: item.unitPrice,
        description: item.description,
      })),
    };
  }

  function save() {
    if (model.state !== "quote" || model.readOnly) return;
    setNotice(null);
    setPendingAction("save");
    const actor = actorFromWindow();
    startTransition(async () => {
      try {
        const result = await upsertQuoteDraft({
          quoteId: model.quoteId,
          version: model.version,
          opportunityId: model.opportunityId,
          ghlUserId: actor.ghlUserId,
          ghlUserEmail: actor.ghlUserEmail,
          ...commercialInput(),
        });
        if (!result.ok) {
          setNotice(result.error);
          return;
        }
        store.patchQuoteState((current) => ({
          ...current,
          version: result.version,
          merchandiseTotal: result.merchandiseTotal ?? current.merchandiseTotal,
        }));
        setNotice(
          result.crmSyncError ? `Draft saved. ${result.crmSyncError}` : "Draft saved.",
        );
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  function addFurnitureItem(product: OrderDeskCatalogProduct) {
    if (model.state !== "quote" || model.readOnly) return;
    setNotice(null);
    setPendingAction("add");
    const actor = actorFromWindow();
    startTransition(async () => {
      try {
        const result = await addCatalogFurnitureLine({
          quoteId: model.quoteId,
          expectedVersion: model.version,
          sku: product.sku,
          variantId: product.variantId,
          qty: 1,
          ghlUserId: actor.ghlUserId,
          ghlUserEmail: actor.ghlUserEmail,
        });
        if (!result.ok) {
          setNotice(result.error);
          return;
        }
        store.appendLine(result.line, result.version, result.merchandiseTotal);
        setAddModalOpen(false);
        setFurnitureQuery("");
        setFurnitureResults([]);
        setNotice(`${product.name} added to quote.`);
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  function addCustom() {
    if (model.state !== "quote" || model.readOnly) return;
    const description = customDescription.trim();
    const price = Number(customPrice.replace(/[$,\s]/g, ""));
    if (!description) {
      setNotice("Enter a description.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setNotice("Enter a price of zero or more.");
      return;
    }
    setNotice(null);
    setPendingAction("custom");
    const actor = actorFromWindow();
    startTransition(async () => {
      try {
        const result = await addCustomLine({
          quoteId: model.quoteId,
          expectedVersion: model.version,
          description,
          unitPrice: price,
          ghlUserId: actor.ghlUserId,
          ghlUserEmail: actor.ghlUserEmail,
        });
        if (!result.ok) {
          setNotice(result.error);
          return;
        }
        store.appendLine(result.line, result.version, result.merchandiseTotal);
        setCustomDescription("");
        setCustomPrice("");
        setCustomOpen(false);
        setNotice("Custom line added.");
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  /** Saves the draft first (so the PDF matches the screen), then builds the requested document. */
  function downloadDocument(kind: "estimate" | "package") {
    if (model.state !== "quote") return;
    setNotice(null);
    setPendingAction(kind === "package" ? "package" : "pdf");
    const actor = actorFromWindow();
    const currentQuoteId = model.quoteId;
    const currentVersion = model.version;
    const readOnly = model.readOnly;
    startTransition(async () => {
      try {
        if (!readOnly) {
          const saved = await upsertQuoteDraft({
            quoteId: currentQuoteId,
            version: currentVersion,
            opportunityId: model.opportunityId,
            ghlUserId: actor.ghlUserId,
            ghlUserEmail: actor.ghlUserEmail,
            ...commercialInput(),
          });
          if (!saved.ok) {
            setNotice(saved.error);
            return;
          }
          store.setVersion(saved.version);
        }
        if (kind === "estimate") {
          const pdf = await generateQuotePdf(currentQuoteId);
          if (!pdf.ok) {
            setNotice(pdf.error);
            return;
          }
          savePdfFile(pdf.pdfBase64, pdf.filename);
          return;
        }
        const pkg = await generateQuotePackage(currentQuoteId);
        if (!pkg.ok) {
          setNotice(pkg.error);
          return;
        }
        savePdfFile(pkg.pdfBase64, pkg.filename);
        const gaps = pkg.report.degraded.length;
        setNotice(
          gaps === 0
            ? `Quote package downloaded: ${pkg.report.pageCount} pages, ${pkg.report.specPages} product ${pkg.report.specPages === 1 ? "page" : "pages"}.`
            : `Quote package downloaded with ${gaps} product ${gaps === 1 ? "page" : "pages"} missing data: ${pkg.report.degraded
                .map((entry) => `${entry.sku} (${entry.issueLabels.join(", ")})`)
                .join("; ")}.`,
        );
      } finally {
        setPendingAction(null);
      }
    });
  }

  function confirmRemove() {
    if (model.state !== "quote" || !removeLineState) return;
    const line = removeLineState;
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
          if (result.version) store.setVersion(result.version);
          return;
        }
        setRemoveLineState(null);
        store.removeLine(line.id);
        store.setVersion(result.version);
        setNotice("Line removed.");
        router.refresh();
      } finally {
        setPendingAction(null);
      }
    });
  }

  function chooseProduct(product: OrderDeskCatalogProduct) {
    if (model.state !== "quote") return;
    const line = lineItems.find((item) => item.id === swapLineId);
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
          if (result.version) store.setVersion(result.version);
          setPendingProduct(null);
          setSwapLineId(null);
          router.refresh();
          return;
        }
        if (!result.ok) {
          setNotice(result.error);
          if (result.version) store.setVersion(result.version);
          return;
        }
        store.setVersion(result.version);
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
      store.patchQuoteState((current) => ({
        ...current,
        version: result.version,
        promiseDate: result.promiseDate,
      }));
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
      store.patchQuoteState((current) => applyFreight(current, result));
    });
  }

  function freezeProposal() {
    if (model.state !== "quote" || model.readOnly || model.status !== "draft") return;
    setNotice(null);
    setPendingAction("send");
    const actor = actorFromWindow();
    startTransition(async () => {
      try {
        const saved = await upsertQuoteDraft({
          quoteId: model.quoteId,
          version: model.version,
          opportunityId: model.opportunityId,
          ghlUserId: actor.ghlUserId,
          ghlUserEmail: actor.ghlUserEmail,
          ...commercialInput(),
        });
        if (!saved.ok) {
          setNotice(saved.error);
          return;
        }

        const result = await finalizeAndSyncQuoteToGhl({
          quoteId: model.quoteId,
          expectedVersion: saved.version,
          ghlUserId: actor.ghlUserId,
          ghlUserEmail: actor.ghlUserEmail,
        });
        if (!result.ok) {
          setNotice(result.error);
          return;
        }
        setSwapLineId(null);
        setRemoveLineState(null);
        setPendingProduct(null);
        store.patchQuoteState((current) => ({
          ...current,
          status: "sent",
          readOnly: true,
          version: result.version,
          ghlSyncError: result.ghlSyncError,
        }));
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
        store.patchQuoteState((current) => ({
          ...current,
          status: "draft",
          readOnly: current.closedOpportunity,
          version: result.version,
          ghlSyncError: null,
        }));
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

  const swapLine = lineItems.find((line) => line.id === swapLineId);
  const quote = model.state === "quote" ? model : null;
  const canSwitchFreight = Boolean(
    quote &&
      !quote.readOnly &&
      quote.freightOptions.some((option) => option.method === "INTERNAL_FLEET") &&
      quote.freightOptions.some((option) => option.method === "PRIORITY1_LTL"),
  );

  const financials = selectQuoteFinancials({
    lineItems,
    discountAmount: discountDraft,
    discountType,
    taxAmount: taxDraft,
    taxRate: store.taxRate,
    shippingCost: store.shippingCost !== "" ? store.shippingCost : quote?.freightTotal ?? null,
    freightTotal: quote?.freightTotal ?? null,
    depositPct: store.depositPct,
  });

  const allLinesPriced =
    lineItems.length > 0 &&
    lineItems.every((item) => {
      const price = item.unitPrice != null ? Number(item.unitPrice) : NaN;
      return Number.isFinite(price) && price >= 0;
    });

  const canSend = Boolean(
    quote &&
      quote.opportunityId &&
      quote.status === "draft" &&
      !quote.readOnly &&
      allLinesPriced &&
      quote.freightTotal != null &&
      quote.promiseDate &&
      /^\d{5}$/.test(zipDraft || quote.destZip || ""),
  );

  if (model.state === "needs-opportunity") {
    return (
      <CustomerSearchHub
        onSelect={startQuote}
        busyOpportunityId={pending && selection ? selection.opportunityId : null}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
      {/* Plain English Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className={eyebrow}>Order Desk</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {model.state === "quote"
              ? customerName || model.opportunityName || "Showroom Quote"
              : "Showroom Quote"}
          </h1>
          {model.state === "quote" && (customerEmail || model.opportunityName) ? (
            <p className="mt-0.5 text-sm text-slate-500">
              {[customerEmail, model.opportunityName].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="order-desk-search-another"
            onClick={searchForAnotherCustomer}
            disabled={pending}
            className="rounded-full px-3.5 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Search for another customer
          </button>
          {model.state === "quote" ? (
            <p
              data-testid="order-desk-status"
              className="rounded-full bg-white px-3.5 py-1 text-xs font-medium uppercase tracking-widest text-slate-600 ring-1 ring-slate-200"
            >
              {statusLabel(model.status)}
            </p>
          ) : null}
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {model.state === "error" ? (
            <section role="alert" data-testid="order-desk-error" className={`${card} px-6 py-6`}>
              <p className="text-sm font-medium text-rose-700">{model.message}</p>
            </section>
          ) : null}

          {model.state === "quote" ? (
            <section data-testid="order-desk-draft" className={`${card} px-5 py-6 sm:px-6`}>
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

              {/* Customer Details & Delivery Information */}
              <div className="grid gap-6 border-b border-slate-100 pb-6 md:grid-cols-2">
                <div data-testid="order-desk-customer" className="space-y-3">
                  <p className={eyebrow}>Customer Details</p>
                  <label className="block text-xs text-slate-500" htmlFor="order-desk-customer-name">
                    Customer Name
                    {model.readOnly ? (
                      <span className="mt-1 block text-sm font-medium text-slate-900">
                        {customerName || "—"}
                      </span>
                    ) : (
                      <input
                        id="order-desk-customer-name"
                        data-testid="order-desk-customer-name"
                        value={customerName}
                        onChange={(event) => store.setCustomerName(event.target.value)}
                        placeholder="Full name"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    )}
                  </label>
                  <label className="block text-xs text-slate-500" htmlFor="order-desk-customer-email">
                    Email Address
                    {model.readOnly ? (
                      <span className="mt-1 block text-sm font-medium text-slate-900">
                        {customerEmail || "—"}
                      </span>
                    ) : (
                      <input
                        id="order-desk-customer-email"
                        data-testid="order-desk-customer-email"
                        type="email"
                        value={customerEmail}
                        onChange={(event) => store.setCustomerEmail(event.target.value)}
                        placeholder="customer@example.com"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    )}
                  </label>
                  <div className="block text-xs text-slate-500">
                    Phone Number
                    <span
                      data-testid="order-desk-customer-phone"
                      className="mt-1 block text-sm font-medium text-slate-900"
                    >
                      {phoneLabel(model.customerPhone) || "—"}
                    </span>
                  </div>
                  <label className="block text-xs text-slate-500" htmlFor="order-desk-bill-to">
                    Billing Address
                    {model.readOnly ? (
                      <span className="mt-1 block whitespace-pre-wrap text-sm font-medium text-slate-900">
                        {billToAddress || "—"}
                      </span>
                    ) : (
                      <textarea
                        id="order-desk-bill-to"
                        data-testid="order-desk-bill-to"
                        value={billToAddress}
                        onChange={(event) => store.setBillToAddress(event.target.value)}
                        rows={2}
                        placeholder="Street, City, State ZIP"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    )}
                  </label>
                </div>

                <div className="space-y-3">
                  <p className={eyebrow}>Delivery Information</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <label htmlFor="order-desk-dest-zip" className="block text-xs text-slate-500">
                        Destination ZIP
                      </label>
                      <div className="font-medium text-slate-900">
                        {model.readOnly ? (
                          <span className="mt-1 block">{model.destZip ?? "—"}</span>
                        ) : (
                          <input
                            id="order-desk-dest-zip"
                            data-testid="order-desk-dest-zip"
                            value={zipDraft}
                            onChange={(event) =>
                              store.setDestZip(event.target.value.replace(/\D/g, "").slice(0, 5))
                            }
                            inputMode="numeric"
                            autoComplete="postal-code"
                            maxLength={5}
                            placeholder="85260"
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                          />
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="block text-xs text-slate-500">Merchandise</span>
                      <span
                        className="mt-2.5 block font-semibold text-slate-900"
                        data-testid="order-desk-total"
                      >
                        {allLinesPriced ? moneyNumber(financials.subtotal) : money(model.merchandiseTotal)}
                      </span>
                    </div>
                  </div>
                  <label className="block text-xs text-slate-500" htmlFor="order-desk-ship-to">
                    Delivery Address
                    {model.readOnly ? (
                      <span className="mt-1 block whitespace-pre-wrap text-sm font-medium text-slate-900">
                        {shipToAddress || "—"}
                      </span>
                    ) : (
                      <textarea
                        id="order-desk-ship-to"
                        data-testid="order-desk-ship-to"
                        value={shipToAddress}
                        onChange={(event) => store.setShipToAddress(event.target.value)}
                        rows={2}
                        placeholder="Delivery street, City, State ZIP"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    )}
                  </label>
                </div>
              </div>

              {/* Quote Items Section */}
              <div className="mt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Quote Items</h2>
                    <p className="text-xs text-slate-500">
                      Adjust quantities or override unit prices inline using Tab.
                    </p>
                  </div>
                  {model.readOnly ? null : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="order-desk-add-furniture"
                        onClick={() => {
                          setNotice(null);
                          setFurnitureQuery("");
                          setFurnitureResults([]);
                          setAddModalOpen(true);
                        }}
                        disabled={pending}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        Add Furniture
                      </button>
                      <button
                        type="button"
                        data-testid="order-desk-add-custom"
                        onClick={() => setCustomOpen((open) => !open)}
                        disabled={pending}
                        className="rounded-full px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        + Add Custom Item
                      </button>
                    </div>
                  )}
                </div>

                {customOpen && !model.readOnly ? (
                  <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3.5 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
                    <label
                      className="block text-xs text-slate-500"
                      htmlFor="order-desk-custom-description"
                    >
                      Item Name
                      <input
                        id="order-desk-custom-description"
                        data-testid="order-desk-custom-description"
                        value={customDescription}
                        onChange={(event) => setCustomDescription(event.target.value)}
                        placeholder="Custom Dekton Insert"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    </label>
                    <label className="block text-xs text-slate-500" htmlFor="order-desk-custom-price">
                      Unit Price
                      <input
                        id="order-desk-custom-price"
                        data-testid="order-desk-custom-price"
                        value={customPrice}
                        onChange={(event) => setCustomPrice(event.target.value)}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    </label>
                    <button
                      type="button"
                      data-testid="order-desk-custom-save"
                      onClick={addCustom}
                      disabled={pending}
                      className="self-end rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {pendingAction === "custom" ? "Adding…" : "Add item"}
                    </button>
                  </div>
                ) : null}

                {lineItems.length === 0 ? (
                  <p data-testid="order-desk-no-lines" className="mt-6 text-sm text-slate-600">
                    This quote has no furniture items yet. Click &ldquo;Add Furniture&rdquo; above to
                    get started.
                  </p>
                ) : (
                  <div
                    data-testid="order-desk-lines"
                    className="mt-4 overflow-x-auto rounded-2xl border border-slate-100"
                  >
                    <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-medium uppercase tracking-wider text-slate-500">
                          <th className="px-4 py-3">Item Name</th>
                          <th className="w-28 px-3 py-3">Qty</th>
                          <th className="w-36 px-3 py-3">Unit Price</th>
                          <th className="w-32 px-4 py-3 text-right">Total</th>
                          {model.readOnly ? null : <th className="w-28 px-3 py-3 text-right" />}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {lineItems.map((line) => {
                          const extended = lineExtended(line.unitPrice, line.qty);
                          return (
                            <tr key={line.id} className="align-top">
                              <td className="px-4 py-3.5">
                                {model.readOnly ? (
                                  <p className="font-medium text-slate-900">{line.description}</p>
                                ) : (
                                  <input
                                    type="text"
                                    value={line.description}
                                    onChange={(event) =>
                                      store.updateLineDescription(line.id, event.target.value)
                                    }
                                    aria-label="Item Name"
                                    className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 font-medium text-slate-900 outline-none transition hover:border-slate-200 focus:border-slate-400 focus:bg-white"
                                  />
                                )}
                                <p className="mt-0.5 px-2 text-xs text-slate-400">
                                  {line.lineKind === "custom" ? "Custom item" : line.sku} · Qty{" "}
                                  {qtyLabel(line.qty)}
                                </p>
                                {line.priceError ? (
                                  <p className="mt-1 px-2 text-xs text-amber-800">{line.priceError}</p>
                                ) : null}
                                {swapLineId === line.id ? (
                                  <div
                                    className="mt-3 rounded-xl bg-slate-50 p-3"
                                    data-testid="order-desk-swap-search"
                                  >
                                    <label
                                      className="block text-xs text-slate-500"
                                      htmlFor={`swap-${line.id}`}
                                    >
                                      Replacement item
                                    </label>
                                    <input
                                      id={`swap-${line.id}`}
                                      value={swapQuery}
                                      onChange={(event) => setSwapQuery(event.target.value)}
                                      placeholder="Search by item name"
                                      autoComplete="off"
                                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                                    />
                                    {searching ? (
                                      <p className="mt-2 text-xs text-slate-500">Searching…</p>
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
                                                <span className="font-medium text-slate-900">
                                                  {product.name}
                                                </span>
                                                <span className="mt-0.5 block text-xs text-slate-500">
                                                  {product.sku}
                                                </span>
                                              </span>
                                              <span className="text-slate-700">
                                                {money(product.unitPrice)}
                                              </span>
                                            </button>
                                          </li>
                                        ))}
                                      </ul>
                                    ) : null}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-3 py-3.5">
                                {model.readOnly ? (
                                  <span className="text-slate-900">{qtyLabel(line.qty)}</span>
                                ) : (
                                  <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    data-testid={`order-desk-qty-${line.id}`}
                                    value={qtyInputValue(line.qty)}
                                    onChange={(event) =>
                                      store.updateLineQty(line.id, event.target.value)
                                    }
                                    aria-label={`Quantity for ${line.description}`}
                                    className="w-20 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900 outline-none focus:border-slate-900"
                                  />
                                )}
                              </td>
                              <td className="px-3 py-3.5">
                                {model.readOnly ? (
                                  <span className="font-medium text-slate-900">
                                    {money(line.unitPrice)}
                                  </span>
                                ) : (
                                  <div>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      data-testid={`order-desk-price-${line.id}`}
                                      value={line.unitPrice ?? ""}
                                      onChange={(event) =>
                                        store.updateLinePrice(line.id, event.target.value)
                                      }
                                      placeholder="0.00"
                                      aria-label={`Unit price for ${line.description}`}
                                      className="w-28 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-900 outline-none focus:border-slate-900"
                                    />
                                    {line.priceOverridden ? (
                                      <span
                                        data-testid={`order-desk-custom-price-badge-${line.id}`}
                                        className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200"
                                      >
                                        Custom Price
                                      </span>
                                    ) : null}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3.5 text-right font-semibold text-slate-900">
                                {extended != null ? moneyNumber(extended) : "—"}
                              </td>
                              {model.readOnly ? null : (
                                <td className="px-3 py-3.5 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {line.holdId ? (
                                      <button
                                        type="button"
                                        data-testid={`order-desk-replace-${line.id}`}
                                        onClick={() => {
                                          setNotice(null);
                                          setPendingProduct(null);
                                          setSwapQuery("");
                                          setProducts([]);
                                          setSwapLineId((current) =>
                                            current === line.id ? null : line.id,
                                          );
                                        }}
                                        disabled={pending}
                                        className="rounded-full px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-60"
                                      >
                                        Replace
                                      </button>
                                    ) : null}
                                    <button
                                      type="button"
                                      aria-label={`Remove ${line.description}`}
                                      data-testid={`order-desk-remove-${line.id}`}
                                      onClick={() => {
                                        setNotice(null);
                                        setRemoveLineState(line);
                                      }}
                                      disabled={pending}
                                      className="rounded-full p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60"
                                    >
                                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

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
                <div className="mt-5 flex items-center justify-end">
                  <button
                    type="button"
                    data-testid="order-desk-save"
                    onClick={save}
                    disabled={pending}
                    className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    {pendingAction === "save" ? "Saving…" : "Save draft"}
                  </button>
                </div>
              )}
            </section>
          ) : null}
        </div>

        {/* Financial Summary Sidebar */}
        {quote ? (
          <aside
            data-testid="order-desk-invoice"
            className={`${card} h-fit px-5 py-5 lg:sticky lg:top-4`}
          >
            <div
              data-testid="order-desk-financials"
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4"
            >
              <p className={eyebrow}>Financial Summary</p>
              <dl className="mt-3 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-slate-500">Subtotal</dt>
                  <dd className="font-medium text-slate-900" data-testid="order-desk-subtotal">
                    {moneyNumber(financials.subtotal)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Discount</dt>
                  <dd className="mt-1">
                    {quote.readOnly ? (
                      <span
                        className="font-medium text-slate-900"
                        data-testid="order-desk-discount-dollars"
                      >
                        {discountType === "PERCENTAGE"
                          ? `${discountDraft || "0"}% (${moneyNumber(financials.discountDollars)})`
                          : moneyNumber(financials.discountDollars)}
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          id="order-desk-discount"
                          data-testid="order-desk-discount"
                          value={discountDraft}
                          onChange={(event) => store.setDiscountAmount(event.target.value)}
                          inputMode="decimal"
                          aria-label="Discount"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                        />
                        <button
                          type="button"
                          data-testid="order-desk-discount-percent"
                          aria-pressed={discountType === "PERCENTAGE"}
                          onClick={() => store.setDiscountType("PERCENTAGE")}
                          className={`rounded-full px-3 py-2 text-xs font-medium ring-1 ${
                            discountType === "PERCENTAGE"
                              ? "bg-slate-900 text-white ring-slate-900"
                              : "text-slate-700 ring-slate-200"
                          }`}
                        >
                          %
                        </button>
                        <button
                          type="button"
                          data-testid="order-desk-discount-flat"
                          aria-pressed={discountType === "FLAT"}
                          onClick={() => store.setDiscountType("FLAT")}
                          className={`rounded-full px-3 py-2 text-xs font-medium ring-1 ${
                            discountType === "FLAT"
                              ? "bg-slate-900 text-white ring-slate-900"
                              : "text-slate-700 ring-slate-200"
                          }`}
                        >
                          $
                        </button>
                      </div>
                    )}
                    {quote.readOnly ? null : (
                      <p
                        className="mt-1 text-xs text-slate-500"
                        data-testid="order-desk-discount-dollars"
                      >
                        {moneyNumber(financials.discountDollars)} off subtotal
                      </p>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">
                    <label htmlFor="order-desk-tax">Tax</label>
                  </dt>
                  <dd className="mt-1">
                    {quote.readOnly ? (
                      <span className="font-medium text-slate-900" data-testid="order-desk-tax">
                        {moneyNumber(financials.tax)}
                      </span>
                    ) : (
                      <input
                        id="order-desk-tax"
                        data-testid="order-desk-tax"
                        value={taxDraft}
                        onChange={(event) => store.setTaxAmount(event.target.value)}
                        inputMode="decimal"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">
                    <label htmlFor="order-desk-shipping-input">Shipping / Delivery</label>
                  </dt>
                  <dd className="mt-1 flex items-center justify-between gap-2">
                    {quote.readOnly ? null : (
                      <input
                        id="order-desk-shipping-input"
                        data-testid="order-desk-shipping-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={store.shippingCost !== "" ? store.shippingCost : quote.freightTotal ?? ""}
                        onChange={(event) => store.setShippingCost(event.target.value)}
                        placeholder="0.00"
                        aria-label="Shipping Cost"
                        className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    )}
                    <span
                      className="ml-auto font-medium text-slate-900"
                      data-testid="order-desk-shipping"
                    >
                      {moneyNumber(financials.shipping)}
                    </span>
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                  <dt className="font-semibold text-slate-900">Grand Total</dt>
                  <dd
                    className="text-lg font-bold text-slate-900"
                    data-testid="order-desk-grand-total"
                  >
                    {moneyNumber(financials.grandTotal)}
                  </dd>
                </div>

                {/* Locked 50% Required Deposit with Manager Override */}
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      {store.depositUnlocked ? (
                        <Unlock className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                      ) : (
                        <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      )}
                      Required {financials.depositPct}% Deposit
                    </span>
                    <div className="flex items-center gap-1.5">
                      {quote.readOnly ? null : (
                        <button
                          type="button"
                          data-testid="order-desk-deposit-override"
                          onClick={() => store.setDepositUnlocked(!store.depositUnlocked)}
                          className="rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-50"
                        >
                          {store.depositUnlocked ? "Lock" : "Manager Override"}
                        </button>
                      )}
                      {store.depositUnlocked && !quote.readOnly ? (
                        <input
                          type="number"
                          min="1"
                          max="100"
                          step="1"
                          aria-label="Deposit percentage"
                          data-testid="order-desk-deposit-pct"
                          value={store.depositPct}
                          onChange={(event) => store.setDepositPct(Number(event.target.value))}
                          className="w-16 rounded-lg border border-amber-300 bg-amber-50/40 px-2 py-1 text-right text-xs font-semibold text-slate-900 outline-none focus:border-slate-900"
                        />
                      ) : (
                        <input
                          type="text"
                          readOnly
                          aria-label="Deposit percentage"
                          data-testid="order-desk-deposit-pct"
                          value={`${financials.depositPct}%`}
                          className="w-16 cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-right text-xs font-semibold text-slate-600"
                        />
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between border-t border-slate-100 pt-2">
                    <span className="text-xs text-slate-500">Due to Start Order</span>
                    <span
                      data-testid="order-desk-deposit-required"
                      className="text-base font-semibold text-slate-900"
                    >
                      {moneyNumber(financials.depositRequired)}
                    </span>
                  </div>
                </div>
              </dl>

              {/* Primary CTA Buttons */}
              <div className="mt-4 space-y-2.5">
                {quote.status === "draft" ? (
                  <div>
                    <button
                      type="button"
                      data-testid="order-desk-send"
                      onClick={freezeProposal}
                      disabled={!canSend || pending}
                      className="w-full rounded-xl bg-blue-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pendingAction === "send" ? "Sending…" : "Send Proposal to Customer"}
                    </button>
                    {quote.opportunityId ? null : (
                      <p className="mt-2 text-xs text-slate-500">
                        A GoHighLevel opportunity is required before sending.
                      </p>
                    )}
                    {quote.opportunityId && !canSend ? (
                      <p className="mt-2 text-xs text-slate-500">
                        A priced item, delivery rate, estimated delivery date, and 5-digit ZIP are
                        required.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {quote.status === "sent" && !quote.closedOpportunity ? (
                  <button
                    type="button"
                    data-testid="order-desk-edit"
                    onClick={editSentQuote}
                    disabled={pending}
                    className="w-full rounded-xl px-4 py-3 text-base font-semibold text-slate-800 ring-1 ring-slate-200 disabled:opacity-60"
                  >
                    {pendingAction === "edit" ? "Returning to draft…" : "Edit Quote"}
                  </button>
                ) : null}

                <button
                  type="button"
                  data-testid="order-desk-download-estimate"
                  onClick={() => downloadDocument("estimate")}
                  disabled={pending}
                  className="w-full rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  {pendingAction === "pdf" ? "Preparing PDF…" : "Preview Estimate"}
                </button>

                <button
                  type="button"
                  data-testid="order-desk-download-pdf"
                  onClick={() => downloadDocument("package")}
                  disabled={pending}
                  className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {pendingAction === "package"
                    ? "Building quote package…"
                    : "Download Quote Package"}
                </button>
                <p className="text-xs text-slate-500">
                  Estimate plus a specification page for every product, as one PDF.
                </p>
              </div>

              {readinessError ? (
                <p
                  role="status"
                  data-testid="order-desk-package-readiness-error"
                  className="mt-3 text-xs text-rose-700"
                >
                  {readinessError}
                </p>
              ) : null}
              {readiness && readiness.length > 0 ? (
                <ul data-testid="order-desk-package-readiness" className="mt-3 space-y-1.5 text-xs">
                  {readiness.map((entry) => (
                    <li
                      key={entry.sku}
                      data-testid={`order-desk-package-readiness-${entry.sku}`}
                      className="flex items-start gap-2"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
                          entry.issues.length === 0 ? "bg-emerald-500" : "bg-amber-400"
                        }`}
                      />
                      <span className="text-slate-700">
                        <span className="font-medium text-slate-900">{entry.productName}</span>
                        {entry.issues.length === 0
                          ? " · page ready"
                          : ` · prints with a gap: ${entry.issueLabels.join(", ")}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            {/* Delivery & Schedule Details */}
            <p className={`${eyebrow} mt-5`}>Delivery Schedule</p>
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Delivery method</dt>
                <dd
                  className="font-medium text-slate-900"
                  data-testid="order-desk-freight-method"
                >
                  {freightMethodLabel(quote.freightMethod, quote.selectedCarrierCode)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Delivery rate</dt>
                <dd className="font-medium text-slate-900" data-testid="order-desk-freight-total">
                  {money(quote.freightTotal)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Estimated delivery</dt>
                <dd className="font-medium text-slate-900" data-testid="order-desk-promise-date">
                  {dateLabel(quote.promiseDate)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500" data-testid="order-desk-promise-copy">
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
                  onChange={(event) => store.setExecutedBy(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </label>
            )}
            {quote.promiseTruckCode ? (
              <p className="mt-2 text-xs text-slate-500">Truck {quote.promiseTruckCode}</p>
            ) : null}
            {promiseErrorLabel(quote.promiseError) ? (
              <p
                className="mt-3 text-sm text-rose-700"
                role="status"
                data-testid="order-desk-promise-error"
              >
                {promiseErrorLabel(quote.promiseError)}
              </p>
            ) : null}
            {quote.readOnly ? null : (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-500">Manager date override</p>
                <label
                  className="mt-2 block text-xs text-slate-500"
                  htmlFor="order-desk-promise-override"
                >
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
                <label
                  className="mt-2 block text-xs text-slate-500"
                  htmlFor="order-desk-promise-reason"
                >
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
                Calculating delivery…
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
              <p
                className="mt-4 text-sm text-rose-700"
                role="status"
                data-testid="order-desk-ghl-sync-error"
              >
                Quote frozen. GoHighLevel was not updated. {quote.ghlSyncError}
              </p>
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

      {/* Add Furniture Full-Screen Takeover Modal */}
      {addModalOpen && quote ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-desk-add-furniture-title"
          data-testid="order-desk-add-furniture-modal"
          className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs"
        >
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <div className={`${card} w-full max-w-2xl px-6 py-6`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className={eyebrow}>Showroom Collection</p>
                  <h2
                    id="order-desk-add-furniture-title"
                    className="mt-1 text-xl font-semibold text-slate-900"
                  >
                    Add Furniture
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    Search by collection or piece name and click any item to add it to this quote.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close Add Furniture"
                  onClick={() => setAddModalOpen(false)}
                  className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="relative mt-5">
                <Search
                  className="pointer-events-none absolute top-3.5 left-3.5 h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  data-testid="order-desk-furniture-search"
                  value={furnitureQuery}
                  onChange={(event) => setFurnitureQuery(event.target.value)}
                  placeholder="Type a collection or piece name (e.g. Marlow Sofa, Club Chair)…"
                  autoFocus
                  autoComplete="off"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pr-4 pl-10 text-sm text-slate-900 outline-none focus:border-slate-900 focus:bg-white"
                />
              </div>

              <div className="mt-4 max-h-96 overflow-y-auto">
                {searchingFurniture ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Finding matching pieces…
                  </p>
                ) : furnitureQuery.trim().length < 2 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Type at least 2 characters to search furniture pieces.
                  </p>
                ) : furnitureResults.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    No matching furniture pieces found.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {furnitureResults.map((product) => (
                      <li key={product.sku}>
                        <button
                          type="button"
                          data-testid={`order-desk-add-item-${product.sku}`}
                          onClick={() => addFurnitureItem(product)}
                          disabled={pending}
                          className="flex w-full items-center justify-between gap-4 rounded-xl px-3 py-3.5 text-left transition hover:bg-slate-50 disabled:opacity-60"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">{product.name}</p>
                            <p className="mt-0.5 text-xs text-slate-400">{product.sku}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="text-sm font-semibold text-slate-900">
                              {money(product.unitPrice)}
                            </span>
                            <span className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                              + Add
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {removeLineState ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="order-desk-remove-title"
          data-testid="order-desk-remove-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
        >
          <div className={`${card} w-full max-w-md px-5 py-5`}>
            <h2 id="order-desk-remove-title" className="text-base font-semibold text-slate-900">
              {removeLineState.holdId ? "Release the previous hold?" : "Remove this item?"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {removeLineState.description} · Qty {qtyLabel(removeLineState.qty)}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRemoveLineState(null)}
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
                  : removeLineState.holdId
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
              {swapLine.description} becomes {pendingProduct.name}. Both answers are required.
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

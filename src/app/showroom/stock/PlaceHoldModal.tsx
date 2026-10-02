"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { useToast } from "@/app/admin/shared/ToastProvider";
import {
  displayStockUom,
  holdQuantityIssue,
  holdQuantityMath,
  holdQuantityWarning,
} from "@/lib/hold-quantity";
import { SHOWROOM_HOLD_TTL_DAYS } from "@/lib/inventory-holds";
import { formatQty, type StockRow } from "@/lib/stock-display";
import { placeShowroomHold, searchGhlHoldTargets, type HoldSearchHit } from "../actions";
import { softField } from "../showroom-ui";

type PlaceHoldModalProps = {
  isOpen: boolean;
  onClose: () => void;
  row: StockRow;
  salesperson: string;
  ghlUserId?: string;
  ghlUserEmail?: string;
  onPlaced: () => void;
};

type HoldStep = "edit" | "confirm";

export function PlaceHoldModal({
  isOpen,
  onClose,
  row,
  salesperson,
  ghlUserId,
  ghlUserEmail,
  onPlaced,
}: PlaceHoldModalProps) {
  const toast = useToast();
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<HoldStep>("edit");
  const [opportunityQuery, setOpportunityQuery] = useState("");
  const [opportunity, setOpportunity] = useState<HoldSearchHit | null>(null);
  const [results, setResults] = useState<HoldSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const searchRequest = useRef(0);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const uom = row.uom?.trim() || displayStockUom(row.sku);
  const availableLabel = `${formatQty(row.available)} ${uom}`;
  const quantityIssue = holdQuantityIssue(qty, row.available);
  const quantityWarning = holdQuantityWarning(qty, row.available);
  const math = holdQuantityMath(qty, row.available);
  const showingConfirm = step === "confirm" && math !== null;

  useEffect(() => {
    if (!isOpen) return;
    setStep("edit");
    setOpportunityQuery("");
    setOpportunity(null);
    setResults([]);
    setSearching(false);
    setQty("");
    setNote("");
    setMessage(null);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || opportunity) return;
    const query = opportunityQuery.trim();
    if (query.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const requestId = ++searchRequest.current;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchGhlHoldTargets(query)
        .then((result) => {
          if (requestId !== searchRequest.current) return;
          setSearching(false);
          if (!result.ok) {
            setResults([]);
            setMessage(result.error);
            return;
          }
          setResults(result.results);
        })
        .catch((error: unknown) => {
          if (requestId !== searchRequest.current) return;
          setSearching(false);
          setResults([]);
          setMessage(error instanceof Error ? error.message : "Opportunity search failed.");
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isOpen, opportunity, opportunityQuery]);

  function review(event: FormEvent) {
    event.preventDefault();
    if (pending || quantityIssue || !math) return;
    if (!opportunity) {
      setMessage("Select an opportunity from the list.");
      return;
    }
    if (!note.trim()) {
      setMessage("A note is required.");
      return;
    }
    setMessage(null);
    setStep("confirm");
  }

  async function confirm() {
    if (pending || !opportunity || !math) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await placeShowroomHold({
        variantId: row.variantId,
        sku: row.sku,
        qty: math.quantity,
        ghlOpportunityId: opportunity.id,
        note: note.trim(),
        ghlUserId,
        ghlUserEmail,
      });
      if (!result.ok) {
        setMessage(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`${result.orderNo} is held until ${new Date(result.expiresAt).toLocaleString()}.`);
      onPlaced();
      onClose();
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : "Could not place the hold.";
      setMessage(text);
      toast.error(text);
    } finally {
      setPending(false);
    }
  }

  if (!isOpen || typeof document === "undefined") return null;

  const qtyDescribedBy = [
    `${titleId}-available`,
    quantityWarning ? `${titleId}-qty-warning` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-md" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="place-hold-modal"
        data-hold-step={showingConfirm ? "confirm" : "edit"}
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_80px_-24px_rgba(15,23,42,0.45)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-900">
              {showingConfirm ? "Confirm hold" : "Place hold"}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{row.name}</p>
            {row.variantLabel ? (
              <p className="break-words line-clamp-3 text-xs text-slate-600">{row.variantLabel}</p>
            ) : null}
            <p className="mt-0.5 font-mono text-xs text-slate-500">{row.sku}</p>
          </div>
          <button
            type="button"
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {showingConfirm && math ? (
          <div data-testid="place-hold-confirm">
            {opportunity ? (
              <p className="mt-4 text-sm text-slate-600">
                {opportunity.name}
                <span className="text-slate-500"> · {opportunity.contactName}</span>
              </p>
            ) : null}
            <dl className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-slate-600">Current Available</dt>
                <dd className="font-medium tabular-nums text-slate-900" data-testid="hold-current-available">
                  {formatQty(math.available)} {uom}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-slate-600">Hold Quantity</dt>
                <dd className="font-medium tabular-nums text-rose-700" data-testid="hold-quantity-delta">
                  -{formatQty(math.quantity)} {uom}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 border-t border-slate-200 pt-2">
                <dt className="font-medium text-slate-900">Ending Available</dt>
                <dd className="font-semibold tabular-nums text-slate-900" data-testid="hold-ending-available">
                  {formatQty(math.ending)} {uom}
                </dd>
              </div>
            </dl>
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
              You are about to lock this inventory for {SHOWROOM_HOLD_TTL_DAYS} days. This will
              immediately remove it from the showroom floor&apos;s available stock.
            </p>
            {message ? <p className="mt-3 text-sm text-rose-700">{message}</p> : null}
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                data-testid="hold-back"
                disabled={pending}
                onClick={() => {
                  setMessage(null);
                  setStep("edit");
                }}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Back/Edit
              </button>
              <button
                type="button"
                data-testid="hold-confirm"
                disabled={pending}
                onClick={() => {
                  void confirm();
                }}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {pending ? "Locking inventory…" : "Confirm & Lock Inventory"}
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              review(event);
            }}
          >
            <p className="mt-4 text-sm text-slate-600">
              This hold ends in {SHOWROOM_HOLD_TTL_DAYS} days. It also ends if the opportunity is
              marked Lost or Abandoned. You can extend it by 14 days before it expires.
            </p>

            <label className="mt-4 block text-xs uppercase tracking-widest text-slate-500">
              Salesperson
              <input
                value={salesperson}
                readOnly
                className={`${softField} mt-1 bg-slate-50 text-slate-700`}
              />
            </label>

            <div className="relative mt-3">
              <label className="block text-xs uppercase tracking-widest text-slate-500" htmlFor={`${titleId}-opportunity`}>
                Opportunity
              </label>
              <input
                id={`${titleId}-opportunity`}
                value={opportunity ? opportunity.name : opportunityQuery}
                onChange={(event) => {
                  setOpportunity(null);
                  setOpportunityQuery(event.target.value);
                  setMessage(null);
                }}
                required
                autoComplete="off"
                role="combobox"
                aria-expanded={!opportunity && results.length > 0}
                aria-controls={`${titleId}-opportunities`}
                aria-autocomplete="list"
                placeholder="Search contacts or opportunities"
                className={`${softField} mt-1`}
              />
              {opportunity ? (
                <p className="mt-1 text-xs text-slate-500">
                  {opportunity.contactName} · {opportunity.status}
                </p>
              ) : null}
              {!opportunity && (searching || results.length > 0 || opportunityQuery.trim().length >= 2) ? (
                <ul
                  id={`${titleId}-opportunities`}
                  role="listbox"
                  className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-[0_8px_30px_rgb(0,0,0,0.08)]"
                >
                  {searching ? <li className="px-3 py-2 text-sm text-slate-500">Searching…</li> : null}
                  {!searching && results.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-slate-500">No open or won opportunity matches.</li>
                  ) : null}
                  {results.map((hit) => (
                    <li key={hit.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-50"
                        onClick={() => {
                          setOpportunity(hit);
                          setOpportunityQuery(hit.name);
                          setResults([]);
                          setMessage(null);
                        }}
                      >
                        <span className="text-sm text-slate-900">{hit.name}</span>
                        <span className="text-xs text-slate-500">
                          {hit.contactName} · {hit.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className="mt-3">
              <label className="block text-xs uppercase tracking-widest text-slate-500" htmlFor={`${titleId}-qty`}>
                Quantity
              </label>
              <p id={`${titleId}-available`} data-testid="hold-available" className="mt-1 text-sm text-slate-700">
                Available to Hold: {availableLabel}
              </p>
              <input
                id={`${titleId}-qty`}
                value={qty}
                onChange={(event) => {
                  setQty(event.target.value);
                  setMessage(null);
                }}
                required
                inputMode="decimal"
                type="number"
                min={1}
                max={row.available}
                step="any"
                aria-invalid={quantityWarning !== null}
                aria-describedby={qtyDescribedBy}
                className={`${softField} mt-1`}
              />
              {quantityWarning ? (
                <p id={`${titleId}-qty-warning`} data-testid="hold-qty-warning" role="alert" className="mt-1 text-sm text-rose-700">
                  {quantityWarning}
                </p>
              ) : null}
            </div>

            <label className="mt-3 block text-xs uppercase tracking-widest text-slate-500">
              Note
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required
                minLength={1}
                maxLength={500}
                rows={3}
                placeholder="Client deciding between Ash and Stone"
                className={`${softField} mt-1 resize-none`}
              />
            </label>

            {message ? <p className="mt-3 text-sm text-rose-700">{message}</p> : null}

            <button
              type="submit"
              data-testid="hold-review"
              disabled={pending || quantityIssue !== null}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Review Hold
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

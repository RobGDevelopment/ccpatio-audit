"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { useToast } from "@/app/admin/shared/ToastProvider";
import { SHOWROOM_HOLD_TTL_HOURS } from "@/lib/inventory-holds";
import type { StockRow } from "@/lib/stock-display";
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
  const [opportunityQuery, setOpportunityQuery] = useState("");
  const [opportunity, setOpportunity] = useState<HoldSearchHit | null>(null);
  const [results, setResults] = useState<HoldSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const searchRequest = useRef(0);
  onCloseRef.current = onClose;
  pendingRef.current = pending;

  useEffect(() => {
    if (!isOpen) return;
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const quantity = Number(qty);
    if (!opportunity) {
      setMessage("Select an opportunity from the list.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await placeShowroomHold({
        variantId: row.variantId,
        sku: row.sku,
        qty: quantity,
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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-md" aria-hidden="true" />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="place-hold-modal"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_24px_80px_-24px_rgba(15,23,42,0.45)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-900">
              Place hold
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

        <p className="mt-4 text-sm text-slate-600">
          This hold ends in {SHOWROOM_HOLD_TTL_HOURS} hours. It also ends if the opportunity is
          marked Lost or Abandoned. There is no extension.
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

        <label className="mt-3 block text-xs uppercase tracking-widest text-slate-500">
          Quantity
          <input
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            required
            inputMode="decimal"
            type="number"
            min="0"
            step="any"
            className={`${softField} mt-1`}
          />
        </label>

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
          disabled={pending}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Placing hold…" : "Place hold"}
        </button>
      </form>
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { formatQty, type StockRow } from "@/lib/stock-display";
import { releaseShowroomHold, type ActiveShowroomHold } from "../actions";

type ReleaseHoldModalProps = {
  isOpen: boolean;
  onClose: () => void;
  row: StockRow;
  holds: ActiveShowroomHold[];
  ghlUserId?: string;
  ghlUserEmail?: string;
  onReleased: () => void;
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function ReleaseHoldModal({
  isOpen,
  onClose,
  row,
  holds,
  ghlUserId,
  ghlUserEmail,
  onReleased,
}: ReleaseHoldModalProps) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  onCloseRef.current = onClose;
  pendingRef.current = pendingId !== null;

  useEffect(() => {
    if (!isOpen) return;
    setPendingId(null);
    setMessage(null);
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingRef.current) onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  async function release(holdId: string) {
    setMessage(null);
    setPendingId(holdId);
    const result = await releaseShowroomHold({ holdId, ghlUserId, ghlUserEmail });
    setPendingId(null);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    onReleased();
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.12)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              Release Hold
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {row.name} · <span className="font-mono">{row.sku}</span>
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-50"
            aria-label="Close"
            onClick={onClose}
            disabled={pendingId !== null}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {holds.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No active holds on this variant.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {holds.map((hold) => (
              <li key={hold.id} className="rounded-xl border border-slate-200 p-3">
                <p className="text-sm font-medium text-slate-900">{hold.opportunityName}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {hold.salesperson} · {formatQty(Number(hold.qty))} · until {formatWhen(hold.expiresAt)}
                </p>
                <p className="mt-1 text-xs text-slate-500">{hold.note}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">{hold.orderNo}</p>
                <button
                  type="button"
                  disabled={pendingId !== null}
                  onClick={() => void release(hold.id)}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  {pendingId === hold.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Release this hold
                </button>
              </li>
            ))}
          </ul>
        )}
        {message ? <p className="mt-3 text-sm text-rose-700">{message}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { formatQty, type StockRow } from "@/lib/stock-display";
import type { ActiveShowroomHold } from "../actions";
import { HoldLifecycleControls } from "./HoldLifecycleControls";

type ReleaseHoldModalProps = {
  isOpen: boolean;
  onClose: () => void;
  row: StockRow;
  holds: ActiveShowroomHold[];
  ghlUserId?: string;
  ghlUserEmail?: string;
  disabled?: boolean;
  onOptimisticRelease: (holdId: string) => void;
  onReleaseFailed: () => void;
  onReleased: () => void;
  onExtended: (holdId: string, expiresAt: string) => void;
};

export function ReleaseHoldModal({
  isOpen,
  onClose,
  row,
  holds,
  ghlUserId,
  ghlUserEmail,
  disabled,
  onOptimisticRelease,
  onReleaseFailed,
  onReleased,
  onExtended,
}: ReleaseHoldModalProps) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  if (!isOpen) return null;

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
              Active Holds
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
                  {hold.salesperson} · {formatQty(Number(hold.qty))}
                </p>
                <p className="mt-1 text-xs text-slate-500">{hold.note}</p>
                <p className="mt-1 font-mono text-[11px] text-slate-400">{hold.orderNo}</p>
                <HoldLifecycleControls
                  hold={hold}
                  ghlUserId={ghlUserId}
                  ghlUserEmail={ghlUserEmail}
                  disabled={disabled}
                  onOptimisticRelease={() => onOptimisticRelease(hold.id)}
                  onReleaseFailed={onReleaseFailed}
                  onReleased={onReleased}
                  onExtended={(expiresAt) => onExtended(hold.id, expiresAt)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

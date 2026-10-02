"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/app/admin/shared/ToastProvider";
import { formatHoldExpiry, SHOWROOM_HOLD_TTL_DAYS } from "@/lib/inventory-holds";
import { extendHold, releaseHold } from "@/server/actions/inventory";
import type { ActiveShowroomHold } from "../actions";

const releaseButton =
  "inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40";
const extendButton =
  "inline-flex items-center gap-2 rounded-xl border border-emerald-500 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40";

function useMinuteNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function HoldLifecycleControls({
  hold,
  ghlUserId,
  ghlUserEmail,
  disabled,
  onOptimisticRelease,
  onReleaseFailed,
  onReleased,
  onExtended,
}: {
  hold: ActiveShowroomHold;
  ghlUserId?: string;
  ghlUserEmail?: string;
  disabled?: boolean;
  onOptimisticRelease: () => void;
  onReleaseFailed: () => void;
  onReleased: () => void;
  onExtended: (expiresAt: string) => void;
}) {
  const toast = useToast();
  const now = useMinuteNow();
  const inflight = useRef(false);
  const [pending, setPending] = useState<"extend" | null>(null);
  const actor = { ghlUserId, ghlUserEmail };
  const locked = disabled || pending !== null;

  async function release() {
    if (inflight.current || disabled) return;
    inflight.current = true;
    onOptimisticRelease();
    const result = await releaseHold(hold.id, actor);
    if (!result.ok) {
      inflight.current = false;
      onReleaseFailed();
      toast.error(result.error);
      return;
    }
    onReleased();
  }

  async function extend() {
    if (inflight.current || disabled) return;
    inflight.current = true;
    setPending("extend");
    const result = await extendHold(hold.id, SHOWROOM_HOLD_TTL_DAYS, actor);
    inflight.current = false;
    setPending(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Hold extended 14 days. ${formatHoldExpiry(result.expiresAt)}.`);
    onExtended(result.expiresAt);
  }

  return (
    <div className="mt-2">
      <p className="text-xs text-slate-600">
        {formatHoldExpiry(hold.expiresAt, new Date(now))}
        <span className="text-slate-400"> · {new Date(hold.expiresAt).toLocaleString()}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="hold-release"
          disabled={locked}
          onClick={() => {
            void release();
          }}
          className={releaseButton}
        >
          Release Hold
        </button>
        <button
          type="button"
          data-testid="hold-extend"
          disabled={locked}
          onClick={() => {
            void extend();
          }}
          className={extendButton}
        >
          {pending === "extend" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Extend 14 Days
        </button>
      </div>
    </div>
  );
}

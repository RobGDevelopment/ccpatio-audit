"use client";

import { useState, useTransition } from "react";

type SyncOutcome = { ok: true; message: string } | { ok: false; error: string };

type KatanaSyncButtonProps = {
  label?: string;
  secondaryLabel?: string;
  onSync: () => Promise<SyncOutcome>;
  className?: string;
};

export function KatanaSyncButton({
  label = "Sync to Katana",
  secondaryLabel,
  onSync,
  className = "",
}: KatanaSyncButtonProps) {
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function showToast(type: "success" | "error", message: string): void {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4200);
  }

  function handleClick(): void {
    startTransition(async () => {
      try {
        const result = await onSync();
        if (result.ok) {
          showToast("success", result.message);
        } else {
          showToast("error", result.error);
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Katana sync failed";
        showToast("error", message);
      }
    });
  }

  return (
    <div className={`relative inline-flex flex-col items-start gap-2 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-lg border-b-2 border-slate-950 bg-slate-800 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-150 ease-out hover:translate-y-[2px] hover:border-b-0 hover:shadow-inner active:translate-y-[2px] active:border-b-0 active:shadow-inner disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isPending ? (
          <span
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
            aria-hidden
          />
        ) : (
          <span aria-hidden className="text-[10px]">
            ↗
          </span>
        )}
        {isPending ? (secondaryLabel ?? "Syncing…") : label}
      </button>

      {toast ? (
        <div
          role="status"
          className={`absolute left-0 top-full z-20 mt-2 min-w-[16rem] max-w-sm rounded-lg border px-3 py-2 text-xs shadow-[0_8px_30px_rgb(0,0,0,0.04)] ${
            toast.type === "success"
              ? "border-emerald-100 bg-emerald-50 text-emerald-700"
              : "border-rose-100 bg-rose-50 text-rose-700"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

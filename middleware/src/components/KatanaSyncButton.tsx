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
        className="inline-flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-300 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? (
          <span
            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-300/30 border-t-sky-300"
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
          className={`absolute left-0 top-full z-20 mt-2 min-w-[16rem] max-w-sm rounded-lg border px-3 py-2 text-xs shadow-lg ${
            toast.type === "success"
              ? "border-emerald-500/30 bg-emerald-950/95 text-emerald-200"
              : "border-red-500/30 bg-red-950/95 text-red-200"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

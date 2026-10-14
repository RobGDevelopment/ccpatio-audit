"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acknowledgeWooPostPaymentEdit,
  discardWooQuarantine,
  replayWooQuarantinedOrder,
  type WooQuarantineActionResult,
} from "./woo-actions";

export type WooQuarantineListItem = {
  id: number;
  externalId: string;
  status: "pending_review" | "post_payment_edit";
  updatedAt: string;
  wooStatus: string | null;
  customer: string | null;
  lines: string[];
  issues: Array<{ path: string; message: string }>;
};

function statusLabel(status: WooQuarantineListItem["status"]): string {
  return status === "pending_review" ? "Validation failed" : "Edited after payment";
}

export function WooQuarantinePanel({
  items,
  focusExternalId,
}: {
  items: WooQuarantineListItem[];
  focusExternalId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Record<number, WooQuarantineActionResult>>({});
  const [reasons, setReasons] = useState<Record<number, string>>({});

  function run(id: number, action: () => Promise<WooQuarantineActionResult>) {
    startTransition(async () => {
      const result = await action();
      setFeedback((prev) => ({ ...prev, [id]: result }));
      if (result.ok) router.refresh();
    });
  }

  return (
    <section
      id="woo-orders"
      className="pim-glass mb-4 rounded-lg p-4 sm:p-5"
      data-testid="woo-quarantine-panel"
    >
      <h2 className="text-xl font-semibold text-zinc-50">
        WooCommerce orders ({items.length})
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-zinc-400">
        Orders that failed SKU or finish validation can be replayed after the hub data is fixed.
        Orders edited after payment are never reprocessed automatically: compare the edit with the
        Katana sales order, then acknowledge it.
      </p>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No open WooCommerce quarantine rows.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {items.map((item) => {
            const result = feedback[item.id];
            const focused = item.externalId === focusExternalId;
            return (
              <li
                key={item.id}
                data-testid={`woo-quarantine-row-${item.id}`}
                className={`rounded border p-3 ${
                  focused ? "border-emerald-500/60" : "border-zinc-800"
                } bg-zinc-950/50`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="font-mono text-sm text-emerald-300/90">
                    Woo order {item.externalId}
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                      item.status === "pending_review"
                        ? "bg-amber-500/20 text-amber-200"
                        : "bg-rose-500/20 text-rose-200"
                    }`}
                  >
                    {statusLabel(item.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {item.wooStatus ?? "unknown status"} · {item.customer ?? "unknown customer"} ·
                  updated {item.updatedAt}
                </p>
                {item.lines.length > 0 ? (
                  <ul className="mt-2 list-inside list-disc text-xs text-zinc-300">
                    {item.lines.map((line, i) => (
                      <li key={`${item.id}-line-${i}`} className="font-mono">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ul className="mt-2 space-y-1 text-xs text-amber-200">
                  {item.issues
                    .filter((issue) => issue.path !== "(fingerprint)")
                    .map((issue, i) => (
                      <li key={`${item.id}-issue-${i}`}>
                        <span className="font-mono text-zinc-500">{issue.path}</span>{" "}
                        {issue.message}
                      </li>
                    ))}
                </ul>

                {result ? (
                  <p
                    className={`mt-3 rounded border px-3 py-2 text-sm ${
                      result.ok
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-rose-500/40 bg-rose-500/10 text-rose-200"
                    }`}
                  >
                    {result.ok ? result.message : result.error}
                  </p>
                ) : null}
                {result && !result.ok && result.issues ? (
                  <ul className="mt-2 space-y-1 text-xs text-rose-200">
                    {result.issues.map((issue, i) => (
                      <li key={`${item.id}-result-${i}`}>
                        <span className="font-mono text-zinc-500">{issue.path}</span>{" "}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="block min-w-0 flex-1 text-xs text-zinc-400">
                    Discard reason
                    <input
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                      value={reasons[item.id] ?? ""}
                      onChange={(e) =>
                        setReasons((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      placeholder="Required to discard"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        run(item.id, () => discardWooQuarantine(item.id, reasons[item.id] ?? ""))
                      }
                      className="rounded border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
                    >
                      Discard
                    </button>
                    {item.status === "pending_review" ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(item.id, () => replayWooQuarantinedOrder(item.id))}
                        className="rounded border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
                      >
                        Replay
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(item.id, () => acknowledgeWooPostPaymentEdit(item.id))}
                        className="rounded border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

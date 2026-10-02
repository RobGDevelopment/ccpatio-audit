"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAndPushOrder,
  rejectOrder,
} from "./actions";
import type { OrderIntakeMappedLine } from "@/server/db/schema";

export type TriageSkuOption = { sku: string; name: string };

export type TriageHold = {
  id: string;
  sku: string;
  qty: string;
  salesperson: string;
  opportunityId: string;
  opportunityName: string;
  note: string;
  expiresAt: string;
  status: string;
  orderNo: string;
};

export type TriageOrderDetail = {
  id: string;
  opportunityId: string;
  status: string;
  version: number;
  contactName: string | null;
  contactEmail: string | null;
  stageName: string | null;
  createdAt: string;
  lastError: string | null;
  rawPayload: unknown;
  attachmentUrls: string[];
  mappedLines: OrderIntakeMappedLine[];
};

function emptyLine(): OrderIntakeMappedLine {
  return { finSku: "", fabricSku: "", quantity: 1 };
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function HoldTable({ holds, title }: { holds: TriageHold[]; title: string }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <h2 className="text-sm font-medium text-zinc-200">{title}</h2>
      {holds.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">No active inventory holds.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-xs text-zinc-300">
            <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">Qty</th>
                <th className="py-2 pr-3 font-medium">Salesperson</th>
                <th className="py-2 pr-3 font-medium">Opportunity</th>
                <th className="py-2 pr-3 font-medium">Note</th>
                <th className="py-2 pr-3 font-medium">Expires</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Order</th>
              </tr>
            </thead>
            <tbody>
              {holds.map((hold) => (
                <tr key={hold.id} className="border-t border-zinc-800">
                  <td className="py-2 pr-3 font-mono text-zinc-100">{hold.sku}</td>
                  <td className="py-2 pr-3 tabular-nums">{hold.qty}</td>
                  <td className="py-2 pr-3">{hold.salesperson}</td>
                  <td className="py-2 pr-3">{hold.opportunityName}</td>
                  <td className="py-2 pr-3">{hold.note}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{formatWhen(hold.expiresAt)}</td>
                  <td className="py-2 pr-3 font-mono text-emerald-300">{hold.status}</td>
                  <td className="py-2 font-mono">{hold.orderNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function OrderTriageClient({
  detail,
  finishedGoods,
  fabrics,
  holds,
}: {
  detail: TriageOrderDetail | null;
  finishedGoods: TriageSkuOption[];
  fabrics: TriageSkuOption[];
  holds: TriageHold[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<OrderIntakeMappedLine[]>(
    detail?.mappedLines.length ? detail.mappedLines : [emptyLine()],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const opportunityHolds = detail
    ? holds.filter((hold) => hold.opportunityId === detail.opportunityId)
    : [];

  if (!detail) {
    return (
      <div className="space-y-4">
        <HoldTable holds={holds} title="Active inventory holds" />
        <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-6 text-sm text-zinc-400">
          No factory orders are waiting. A GHL opportunity in Produce Factory Order
          will show up here.
        </p>
      </div>
    );
  }

  function updateLine(index: number, patch: Partial<OrderIntakeMappedLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    );
  }

  function submit(kind: "approve" | "reject") {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result =
        kind === "reject"
          ? await rejectOrder({ id: detail!.id, version: detail!.version })
          : await approveAndPushOrder({
              id: detail!.id,
              version: detail!.version,
              lines,
            });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
    <HoldTable holds={holds} title="Active inventory holds" />
    {opportunityHolds.length > 0 ? (
      <HoldTable holds={opportunityHolds} title="Holds on this opportunity" />
    ) : (
      <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
        This opportunity has no active inventory holds.
      </p>
    )}
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="text-sm font-medium text-zinc-200">GHL payload</h2>
        <dl className="mt-3 space-y-1 text-xs text-zinc-400">
          <div>Opportunity <span className="font-mono text-zinc-200">{detail.opportunityId}</span></div>
          <div>Contact <span className="text-zinc-200">{detail.contactName ?? "—"}</span></div>
          <div>Email <span className="text-zinc-200">{detail.contactEmail ?? "—"}</span></div>
          <div>Stage <span className="text-zinc-200">{detail.stageName ?? "—"}</span></div>
          <div>Status <span className="font-mono text-emerald-300">{detail.status}</span></div>
        </dl>
        {detail.lastError ? (
          <p className="mt-3 text-xs text-rose-300">{detail.lastError}</p>
        ) : null}
        {detail.attachmentUrls.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs">
            {detail.attachmentUrls.map((url) => (
              <li key={url}>
                <a href={url} className="text-emerald-400 hover:text-emerald-300" target="_blank" rel="noreferrer">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <pre className="mt-3 max-h-[32rem] overflow-auto rounded bg-zinc-900 p-3 text-[11px] leading-relaxed text-zinc-300">
          {JSON.stringify(detail.rawPayload, null, 2)}
        </pre>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="text-sm font-medium text-zinc-200">Map Hub SKUs</h2>
        <div className="mt-3 space-y-3">
          {lines.map((line, index) => (
            <div key={index} className="grid gap-2 rounded border border-zinc-800 p-3">
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">
                Finished good
                <select
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                  value={line.finSku}
                  onChange={(event) => updateLine(index, { finSku: event.target.value })}
                >
                  <option value="">Select FIN-*</option>
                  {finishedGoods.map((option) => (
                    <option key={option.sku} value={option.sku}>
                      {option.sku} — {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">
                Fabric
                <select
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                  value={line.fabricSku}
                  onChange={(event) => updateLine(index, { fabricSku: event.target.value })}
                >
                  <option value="">Select FAB-*</option>
                  {fabrics.map((option) => (
                    <option key={option.sku} value={option.sku}>
                      {option.sku} — {option.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">
                Quantity
                <input
                  type="number"
                  min={0.0001}
                  step="any"
                  className="mt-1 w-32 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
                  value={line.quantity}
                  onChange={(event) =>
                    updateLine(index, { quantity: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 text-xs text-zinc-400 hover:text-zinc-200"
          onClick={() => setLines((current) => [...current, emptyLine()])}
        >
          Add line
        </button>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => submit("approve")}
            className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Approve & Push to Katana"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => submit("reject")}
            className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
        {message ? <p className="mt-3 text-sm text-emerald-300">{message}</p> : null}
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      </section>
    </div>
    </div>
  );
}

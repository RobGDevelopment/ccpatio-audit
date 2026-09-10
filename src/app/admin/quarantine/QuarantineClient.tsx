"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveIntake,
  rejectIntake,
  type EnrichmentInput,
} from "./actions";
import type { DraftBomNode, DraftProductSummary } from "@/server/sketchup/draft-bom";

export type QuarantineListItem = {
  exportId: string;
  proposedSku: string | null;
  createdBy: string | null;
  version: number;
  createdAt: string;
  productName: string | null;
};

export type QuarantineDetail = QuarantineListItem & {
  rawPayload: unknown;
  draft: DraftProductSummary | null;
  missingSkuCount: number;
};

function BomTree({
  nodes,
  depth = 0,
}: {
  nodes: DraftBomNode[];
  depth?: number;
}) {
  if (nodes.length === 0) {
    return (
      <p className="text-xs text-zinc-500">No draft BOM lines in payload.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {nodes.map((node) => (
        <li key={`${depth}-${node.sku}`} className="text-sm">
          <div
            className={`rounded border px-2 py-1.5 font-mono text-xs ${
              node.existsInHub
                ? "border-zinc-700/80 bg-zinc-900/40 text-zinc-300"
                : "border-amber-500/50 bg-amber-500/10 text-amber-100"
            }`}
            style={{ marginLeft: depth * 12 }}
          >
            <span className="font-semibold">{node.sku}</span>
            <span className="ml-2 text-zinc-500">
              ×{node.qty} {node.uom} · {node.itemType}
            </span>
            {!node.existsInHub ? (
              <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                Missing from hub
              </span>
            ) : (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-400/80">
                In hub
              </span>
            )}
          </div>
          {node.children.length > 0 ? (
            <BomTree nodes={node.children} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function QuarantineClient({
  items,
  selected,
}: {
  items: QuarantineListItem[];
  selected: QuarantineDetail | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const defaults = useMemo(() => {
    const draft = selected?.draft;
    return {
      canonicalSku:
        selected?.proposedSku?.trim() ||
        draft?.proposedSku?.trim() ||
        "",
      msrp: "",
      cost: "",
      seoTitle: draft?.name ?? "",
      seoDescription: "",
      slug: "",
      syncToWoo: false,
      syncToClover: false,
    };
  }, [selected]);

  const [form, setForm] = useState(defaults);

  useEffect(() => {
    setForm(defaults);
    setError(null);
    setMessage(null);
    setRejectReason("");
  }, [defaults, selected?.exportId]);

  function selectIntake(exportId: string) {
    router.push(`/admin/quarantine?id=${encodeURIComponent(exportId)}`);
  }

  function onApprove() {
    if (!selected) return;
    setError(null);
    setMessage(null);
    const payload: EnrichmentInput = {
      expectedVersion: selected.version,
      canonicalSku: form.canonicalSku,
      msrp: form.msrp,
      cost: form.cost,
      seoTitle: form.seoTitle,
      seoDescription: form.seoDescription,
      slug: form.slug,
      syncToWoo: form.syncToWoo,
      syncToClover: form.syncToClover,
    };
    startTransition(async () => {
      const result = await approveIntake(selected.exportId, payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "Approved.");
      router.push("/admin/quarantine");
      router.refresh();
    });
  }

  function onReject() {
    if (!selected) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await rejectIntake(
        selected.exportId,
        rejectReason,
        selected.version,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message ?? "Rejected.");
      router.push("/admin/quarantine");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_1fr]">
      <aside className="pim-glass max-h-[75vh] overflow-auto rounded-lg">
        <div className="border-b border-zinc-800 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
          Quarantined ({items.length})
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-sm text-zinc-500">
            No quarantined SketchUp intakes.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-800/80">
            {items.map((item) => {
              const active = item.exportId === selected?.exportId;
              return (
                <li key={item.exportId}>
                  <button
                    type="button"
                    onClick={() => selectIntake(item.exportId)}
                    className={`w-full px-3 py-3 text-left transition ${
                      active
                        ? "bg-emerald-500/10"
                        : "hover:bg-zinc-900/60"
                    }`}
                  >
                    <div className="font-mono text-xs text-emerald-300/90">
                      {item.proposedSku ?? "(no proposed SKU)"}
                    </div>
                    <div className="mt-1 truncate text-sm text-zinc-200">
                      {item.productName ?? "Untitled"}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      {item.createdBy ?? "unknown"} · v{item.version}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <section className="pim-glass rounded-lg p-4 sm:p-5">
        {!selected ? (
          <p className="text-sm text-zinc-500">
            Select an intake to review MSRP, SEO, and the draft BOM.
          </p>
        ) : (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-zinc-50">
                {selected.draft?.name ?? selected.productName ?? "Intake"}
              </h2>
              <p className="mt-1 font-mono text-xs text-zinc-500">
                export_id={selected.exportId} · version={selected.version}
              </p>
              {selected.missingSkuCount > 0 ? (
                <p className="mt-2 text-sm text-amber-300">
                  {selected.missingSkuCount} draft SKU
                  {selected.missingSkuCount === 1 ? "" : "s"} missing from the
                  hub — Approve will mint them.
                </p>
              ) : (
                <p className="mt-2 text-sm text-emerald-400/90">
                  All draft BOM SKUs exist on the hub (or tree is empty).
                </p>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-xs text-zinc-400">
                Canonical SKU
                <input
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100"
                  value={form.canonicalSku}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, canonicalSku: e.target.value }))
                  }
                />
              </label>
              <label className="block text-xs text-zinc-400">
                MSRP
                <input
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  value={form.msrp}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, msrp: e.target.value }))
                  }
                  placeholder="Required if Woo or Clover"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                Cost
                <input
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  value={form.cost}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cost: e.target.value }))
                  }
                />
              </label>
              <label className="block text-xs text-zinc-400">
                Slug
                <input
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  value={form.slug}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, slug: e.target.value }))
                  }
                />
              </label>
              <label className="block text-xs text-zinc-400 md:col-span-2">
                SEO title
                <input
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  value={form.seoTitle}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, seoTitle: e.target.value }))
                  }
                />
              </label>
              <label className="block text-xs text-zinc-400 md:col-span-2">
                SEO description
                <textarea
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  rows={3}
                  value={form.seoDescription}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, seoDescription: e.target.value }))
                  }
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.syncToWoo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, syncToWoo: e.target.checked }))
                  }
                />
                Sync to WooCommerce
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.syncToClover}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, syncToClover: e.target.checked }))
                  }
                />
                Sync to Clover (retail)
              </label>
            </div>

            <div>
              <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
                Draft BOM
              </h3>
              <BomTree nodes={selected.draft?.subassemblies ?? []} />
            </div>

            <details className="rounded border border-zinc-800 bg-zinc-950/50 p-3">
              <summary className="cursor-pointer text-xs text-zinc-400">
                Raw payload JSON
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto text-[11px] text-zinc-400">
                {JSON.stringify(selected.rawPayload, null, 2)}
              </pre>
            </details>

            {error ? (
              <p className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                {message}
              </p>
            ) : null}

            <div className="flex flex-col gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-end sm:justify-between">
              <label className="block min-w-0 flex-1 text-xs text-zinc-400">
                Reject reason
                <input
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Required to reject"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={onReject}
                  className="rounded border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 transition hover:bg-rose-500/20 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={onApprove}
                  className="rounded border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-50"
                >
                  Approve
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

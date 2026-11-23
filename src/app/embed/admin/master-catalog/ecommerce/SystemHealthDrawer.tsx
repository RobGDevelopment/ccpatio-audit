"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, X, Activity, RefreshCw, BookOpen } from "lucide-react";
import {
  getSystemHealthAction,
  requestKatanaSelfHealAction,
  replayHeldWooOrderAction,
  type SystemHealthSnapshot,
} from "../actions";

type Lamp = SystemHealthSnapshot["katanaSyncAge"];

function LampDot({ state }: { state: Lamp["state"] }) {
  const color =
    state === "healthy"
      ? "bg-emerald-500"
      : state === "degraded"
        ? "bg-amber-500"
        : "bg-rose-500";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />;
}

function LampRow({
  lamp,
  action,
}: {
  lamp: Lamp;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5"
      data-testid={`health-lamp-${lamp.id}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <LampDot state={lamp.state} />
          {lamp.label}
        </div>
        <p className="mt-0.5 text-xs text-slate-500">{lamp.detail}</p>
      </div>
      {action}
    </div>
  );
}

const RUNBOOK = [
  {
    q: "A new item appeared in Katana — how does it reach Showroom?",
    a: "Every 2 hours the Hub self-heal sync pulls Katana stock and new SKUs automatically. Showroom reads the Hub snapshot (no live Katana call), so Current Inventory stays fresh even if a webhook drops. New items land as Phase 2 (not published to the website).",
  },
  {
    q: "How do I approve a Phase 2 item for the website?",
    a: "Open the Phase 2 & New Products tab, fill MSRP / dims / story, upload swatches or 3D if needed, then promote to Live E-Commerce. The Hub never auto-publishes — website publish is always a deliberate click.",
  },
  {
    q: "How do I upload 3D models or fabric/powder swatches?",
    a: "Use Swatches, Finishes & Add-Ons for FAB-*/PWD-*/DEC-* placeholders, and the 3D media drawer on a listing for .glb/.usdz. Placeholders arrive as placeholder_lowres until a photoshoot upload replaces them.",
  },
  {
    q: "A website order is Held — what do I do?",
    a: "Usually a typoed SKU. Fix the SKU in the catalog/dictionary, then click Re-Verify SKU & Replay Order below. You do not need Vercel or Supabase.",
  },
  {
    q: "How do we rotate API keys (Katana / Woo / QuickBooks)?",
    a: "Update the secret in Vercel (or Vault for Katana), then redeploy. For QuickBooks, use Mission Control → Reconnect OAuth. After rotating Katana, click Run Self-Heal Sync Now to prove the new token works.",
  },
];

export default function SystemHealthDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function reload() {
    startTransition(async () => {
      const result = await getSystemHealthAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setSnapshot(result.snapshot);
    });
  }

  useEffect(() => {
    if (open) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[2px]"
      data-testid="system-health-drawer"
      role="dialog"
      aria-label="System Health, Held Orders & Admin Runbook"
    >
      <button
        type="button"
        className="flex-1 cursor-default"
        aria-label="Close system health drawer"
        onClick={onClose}
      />
      <aside className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-sky-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                System Health, Held Orders &amp; Admin Runbook
              </h2>
              <p className="text-[11px] text-slate-500">
                {snapshot?.overall ?? "Loading…"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
          )}
          {toast && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{toast}</p>
          )}
          {pending && !snapshot ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading health…
            </div>
          ) : snapshot ? (
            <>
              <section className="space-y-2" data-testid="health-lamps">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Live lamps
                </h3>
                <LampRow
                  lamp={snapshot.katanaSyncAge}
                  action={
                    <button
                      type="button"
                      data-testid="run-self-heal-btn"
                      disabled={pending}
                      onClick={() => {
                        startTransition(async () => {
                          const result = await requestKatanaSelfHealAction();
                          setToast(
                            result.ok
                              ? "Self-heal sync queued — inventory refreshes within a few minutes."
                              : result.error,
                          );
                          reload();
                        });
                      }}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Run Self-Heal Sync Now
                    </button>
                  }
                />
                <LampRow lamp={snapshot.wooWebhook} />
                <LampRow lamp={snapshot.qbo} />
                <LampRow lamp={snapshot.heldOrders} />
              </section>

              <section data-testid="held-orders-replay">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  1-Click Held Order Replay
                </h3>
                {snapshot.heldOrderRows.length === 0 ? (
                  <p className="text-xs text-slate-500">No held Woo orders right now.</p>
                ) : (
                  <ul className="space-y-2">
                    {snapshot.heldOrderRows.map((row) => (
                      <li
                        key={row.id}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                        data-testid={`held-order-${row.id}`}
                      >
                        <div className="font-mono text-xs font-semibold text-slate-800">
                          {row.externalId}
                        </div>
                        <p className="mt-1 text-xs text-slate-600">{row.reason}</p>
                        <button
                          type="button"
                          disabled={pending || row.status !== "pending_review"}
                          onClick={() => {
                            startTransition(async () => {
                              const result = await replayHeldWooOrderAction(row.id);
                              setToast(result.ok ? result.message : result.error);
                              reload();
                            });
                          }}
                          className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 disabled:opacity-50"
                        >
                          Re-Verify SKU &amp; Replay Order
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section data-testid="baton-pass-runbook">
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <BookOpen className="h-3.5 w-3.5" />
                  Pass-the-Baton Operator Guide
                </h3>
                <dl className="space-y-3">
                  {RUNBOOK.map((item) => (
                    <div key={item.q} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2">
                      <dt className="text-xs font-semibold text-slate-800">{item.q}</dt>
                      <dd className="mt-1 text-xs leading-relaxed text-slate-600">{item.a}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

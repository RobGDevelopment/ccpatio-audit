"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  buildWooDiagnosticReportAction,
  getExecutiveStackHealthAction,
  resetKatanaBucketAndSyncAction,
  runKatanaSyncNowAction,
  testWooConnectionAction,
} from "../actions";
import {
  probeFailedStackLayers,
  type StackLayerPill,
  type StackLampStatus,
} from "@/server/ecommerce/executive-stack-health";
import { QBO_OAUTH_RESULT_MESSAGE_TYPE } from "@/server/integrations/qbo/oauth";

const LAMP_CLASS: Record<StackLampStatus, string> = {
  Healthy: "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40",
  Degraded: "bg-amber-500/20 text-amber-100 ring-amber-500/40",
  "Action Required": "bg-rose-500/20 text-rose-100 ring-rose-500/40",
};

const LAMP_DOT: Record<StackLampStatus, string> = {
  Healthy: "bg-emerald-400",
  Degraded: "bg-amber-400",
  "Action Required": "bg-rose-400",
};

type Props = {
  onToast: (msg: string) => void;
  onLayerClick?: (layerId: StackLayerPill["id"]) => void;
  initialLayers?: StackLayerPill[] | null;
  onDrawerAction?: (
    layerId: StackLayerPill["id"],
    actionId: string,
  ) => void | Promise<void>;
  drawerExtras?: React.ReactNode;
};

export default function ExecutiveStackHealthStrip({
  onToast,
  onLayerClick,
  initialLayers = null,
  onDrawerAction,
  drawerExtras,
}: Props) {
  const [layers, setLayers] = useState<StackLayerPill[]>(
    () => initialLayers ?? probeFailedStackLayers("Probing full stack…"),
  );
  const [loading, setLoading] = useState(!initialLayers?.length);
  const [busy, setBusy] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [openLayer, setOpenLayer] = useState<StackLayerPill["id"] | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getExecutiveStackHealthAction();
      if (res.ok) {
        setLayers(res.health.layers);
      } else {
        onToast(res.error);
        setLayers(probeFailedStackLayers());
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Stack health probe failed");
      setLayers(probeFailedStackLayers());
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; ok?: boolean } | null;
      if (!data || data.type !== QBO_OAUTH_RESULT_MESSAGE_TYPE) return;
      onToast(
        data.ok
          ? "QuickBooks Online Connected — refreshing stack…"
          : "QuickBooks reconnect failed — check credentials",
      );
      void refresh();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onToast, refresh]);

  useEffect(() => {
    if (!openLayer) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenLayer(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openLayer]);

  function toggleDrawer(id: StackLayerPill["id"]) {
    const next = openLayer === id ? null : id;
    setOpenLayer(next);
    if (next) onLayerClick?.(next);
  }

  const selectedLayer = layers.find((l) => l.id === openLayer) ?? null;

  /* ── Internal action handlers (existing wired actions) ── */
  async function runAction(layerId: StackLayerPill["id"], actionId: string) {
    setBusy(`${layerId}-${actionId}`);
    const syncingKatana =
      actionId === "katana_sync_now" || actionId === "katana_reset_bucket_sync";
    if (syncingKatana) setBusyLabel("Syncing live Katana inventory…");
    try {
      if (actionId === "katana_sync_now") {
        const res = await runKatanaSyncNowAction();
        onToast(
          res.ok
            ? `Synced ${res.syncedItemsCount} Katana items · just now`
            : res.error,
        );
        if (res.ok) await refresh();
      } else if (actionId === "katana_reset_bucket_sync") {
        const res = await resetKatanaBucketAndSyncAction();
        onToast(
          res.ok
            ? `Bucket reset · synced ${res.syncedItemsCount} Katana items · just now`
            : res.error,
        );
        if (res.ok) await refresh();
      } else if (actionId === "qbo_reconnect") {
        const embedKey =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search).get("key")
            : null;
        const connectUrl = embedKey
          ? `/api/auth/qbo/connect?key=${encodeURIComponent(embedKey)}`
          : "/api/auth/qbo/connect";
        window.open(connectUrl, "ccpatio_qbo_oauth", "popup,width=680,height=780");
      } else if (actionId === "woo_retest") {
        const res = await testWooConnectionAction();
        onToast(res.ok ? `Connected to ${res.host}` : res.reason);
        await refresh();
      } else if (actionId === "woo_copy_diagnostic") {
        const res = await buildWooDiagnosticReportAction();
        if (!res.ok) {
          onToast(res.error);
        } else {
          try {
            await navigator.clipboard.writeText(res.report);
            onToast("Woo diagnostic copied for PrimeView");
          } catch {
            onToast("Could not copy — select diagnostic from toast log");
          }
        }
      } else if (onDrawerAction) {
        await onDrawerAction(layerId, actionId);
        // DLQ resolve/archive + QBO verify + re-probe must refresh the pill strip in place.
        if (
          actionId.startsWith("dlq_") ||
          actionId === "layer_reprobe" ||
          actionId === "qbo_verify_token" ||
          actionId === "qbo_verify_credentials_pair"
        ) {
          await refresh();
        }
      }
    } finally {
      setBusy(null);
      setBusyLabel(null);
    }
  }

  return (
    <div className="mb-4">
      {/* ───── Compact pill bar ───── */}
      <div
        className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1"
        data-testid="executive-stack-health-strip"
        data-collapsed-height="true"
        data-probing={loading ? "true" : "false"}
        style={{ maxHeight: openLayer ? undefined : 90 }}
      >
        {layers.map((layer) => (
          <button
            key={layer.id}
            type="button"
            data-testid={`stack-layer-${layer.id}`}
            title={layer.detail}
            onClick={() => toggleDrawer(layer.id)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[11px] font-semibold ring-1 transition hover:brightness-110 ${LAMP_CLASS[layer.status]} ${
              openLayer === layer.id ? "ring-2 brightness-125" : ""
            }`}
          >
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${LAMP_DOT[layer.status]}`}
              aria-hidden="true"
            />
            <span className="leading-tight">
              {layer.label}
              {loading ? " …" : ""}
            </span>
          </button>
        ))}
      </div>

      {/* ───── Diagnostic drawer ───── */}
      {selectedLayer && (
        <div
          data-testid="stack-diagnostic-drawer"
          className="mt-2 rounded-xl border border-white/10 bg-[#0d1117] px-4 py-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-white">
                {selectedLayer.label}
                <span
                  className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${LAMP_CLASS[selectedLayer.status]}`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${LAMP_DOT[selectedLayer.status]}`}
                  />
                  {selectedLayer.status}
                </span>
              </h3>
              <p className="mt-1 text-xs text-slate-400">{selectedLayer.detail}</p>
              {busyLabel && openLayer === selectedLayer.id ? (
                <p
                  className="mt-2 flex items-center gap-2 text-xs text-amber-200"
                  data-testid="katana-sync-spinner"
                >
                  <span
                    className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-300/30 border-t-amber-300"
                    aria-hidden="true"
                  />
                  {busyLabel}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              data-testid="stack-drawer-close"
              onClick={() => setOpenLayer(null)}
              className="rounded p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
              aria-label="Close drawer"
            >
              <X size={16} strokeWidth={2.25} />
            </button>
          </div>

          {selectedLayer.errorSnippet && selectedLayer.id === "woocommerce" ? (
            <details className="mt-2 rounded-md border border-white/10 bg-black/30 px-3 py-2">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Raw diagnostic (JSON / HTML)
              </summary>
              <pre className="mt-2 max-h-32 overflow-auto font-mono text-[10px] leading-relaxed text-rose-300 whitespace-pre-wrap break-all">
                {selectedLayer.errorSnippet}
              </pre>
            </details>
          ) : selectedLayer.errorSnippet ? (
            <pre className="mt-2 max-h-24 overflow-auto rounded-md bg-black/40 px-3 py-2 font-mono text-[10px] leading-relaxed text-rose-300">
              {selectedLayer.errorSnippet}
            </pre>
          ) : null}

          {selectedLayer.actions?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedLayer.actions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  data-testid={`stack-action-${selectedLayer.id}-${a.id}`}
                  disabled={busy === `${selectedLayer.id}-${a.id}`}
                  onClick={() => void runAction(selectedLayer.id, a.id)}
                  className="rounded-md bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-200 transition hover:bg-white/20 disabled:opacity-50"
                >
                  {busy === `${selectedLayer.id}-${a.id}`
                    ? syncingLabel(a.id, busyLabel)
                    : a.label}
                </button>
              ))}
            </div>
          ) : null}

          {/* Render drawerExtras when inngest DLQ layer is open */}
          {openLayer === "inngest_dlq" && drawerExtras ? (
            <div className="mt-3 border-t border-white/10 pt-3">{drawerExtras}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function syncingLabel(actionId: string, busyLabel: string | null): string {
  if (
    (actionId === "katana_sync_now" || actionId === "katana_reset_bucket_sync") &&
    busyLabel
  ) {
    return busyLabel;
  }
  return "…";
}

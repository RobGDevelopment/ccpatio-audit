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

  function toggleDrawer(id: StackLayerPill["id"]) {
    const next = openLayer === id ? null : id;
    setOpenLayer(next);
    if (next) onLayerClick?.(next);
  }

  const selectedLayer = layers.find((l) => l.id === openLayer) ?? null;

  /* ── Internal action handlers (existing wired actions) ── */
  async function runAction(layerId: StackLayerPill["id"], actionId: string) {
    setBusy(`${layerId}-${actionId}`);
    try {
      if (actionId === "katana_sync_now") {
        const res = await runKatanaSyncNowAction();
        onToast(res.ok ? res.message : res.error);
        if (res.ok) await refresh();
      } else if (actionId === "katana_reset_bucket_sync") {
        const res = await resetKatanaBucketAndSyncAction();
        onToast(res.ok ? res.message : res.error);
        if (res.ok) await refresh();
      } else if (actionId === "qbo_reconnect") {
        window.open("/api/auth/qbo/connect", "_blank", "noopener,noreferrer");
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
      }
    } finally {
      setBusy(null);
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
          <div className="flex items-start justify-between">
            <div>
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
            </div>
            <button
              type="button"
              onClick={() => setOpenLayer(null)}
              className="rounded p-1 text-slate-500 transition hover:bg-white/10 hover:text-white"
              aria-label="Close drawer"
            >
              <X size={14} />
            </button>
          </div>

          {selectedLayer.errorSnippet && (
            <pre className="mt-2 max-h-24 overflow-auto rounded-md bg-black/40 px-3 py-2 font-mono text-[10px] leading-relaxed text-rose-300">
              {selectedLayer.errorSnippet}
            </pre>
          )}

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
                  {busy === `${selectedLayer.id}-${a.id}` ? "…" : a.label}
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

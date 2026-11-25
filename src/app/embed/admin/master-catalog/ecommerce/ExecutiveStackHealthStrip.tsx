"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  buildWooDiagnosticReportAction,
  getExecutiveStackHealthAction,
  runKatanaSyncNowAction,
  testWooConnectionAction,
} from "../actions";
import type { StackLayerPill, StackLampStatus } from "@/server/ecommerce/executive-stack-health";

const LAMP_CLASS: Record<StackLampStatus, string> = {
  Healthy: "bg-emerald-500/20 text-emerald-200 ring-emerald-500/40",
  Degraded: "bg-amber-500/20 text-amber-100 ring-amber-500/40",
  "Action Required": "bg-rose-500/20 text-rose-100 ring-rose-500/40",
};

type Props = {
  onToast: (msg: string) => void;
  onLayerClick?: (layerId: StackLayerPill["id"]) => void;
};

export default function ExecutiveStackHealthStrip({ onToast, onLayerClick }: Props) {
  const [layers, setLayers] = useState<StackLayerPill[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await getExecutiveStackHealthAction();
    if (res.ok) {
      setLayers(res.health.layers);
    } else {
      onToast(res.error);
      setLayers(null);
    }
    setLoading(false);
  }, [onToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runAction(layerId: StackLayerPill["id"], actionId: string) {
    setBusy(`${layerId}-${actionId}`);
    try {
      if (actionId === "katana_sync_now") {
        const res = await runKatanaSyncNowAction();
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
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="mb-6 grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-7"
      data-testid="executive-stack-health-strip"
    >
      {loading && !layers ? (
        <div className="col-span-full flex items-center gap-2 py-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
          Probing full stack…
        </div>
      ) : null}
      {(layers ?? []).map((layer) => (
        <button
          key={layer.id}
          type="button"
          data-testid={`stack-layer-${layer.id}`}
          title={layer.detail}
          onClick={() => onLayerClick?.(layer.id)}
          className={`flex min-h-[4.5rem] flex-col items-start rounded-xl px-3 py-2 text-left ring-1 transition hover:brightness-110 ${LAMP_CLASS[layer.status]}`}
        >
          <span className="text-[10px] font-bold uppercase tracking-wide opacity-90">{layer.label}</span>
          <span className="mt-0.5 text-[11px] font-semibold leading-tight">{layer.status}</span>
          <span className="mt-1 line-clamp-2 text-[10px] opacity-80">{layer.detail}</span>
          {layer.errorSnippet ? (
            <span className="mt-1 line-clamp-2 text-[9px] font-mono opacity-70">{layer.errorSnippet}</span>
          ) : null}
          {layer.actions?.length ? (
            <span className="mt-2 flex flex-wrap gap-1">
              {layer.actions.map((a) => (
                <span
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  className="rounded bg-black/25 px-1.5 py-0.5 text-[9px] font-semibold uppercase hover:bg-black/40"
                  onClick={(e) => {
                    e.stopPropagation();
                    void runAction(layer.id, a.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.stopPropagation();
                      void runAction(layer.id, a.id);
                    }
                  }}
                >
                  {busy === `${layer.id}-${a.id}` ? "…" : a.label}
                </span>
              ))}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
"use client";

import { useEffect, useState } from "react";
import { getQboConnectionAction } from "@/app/mission-control/qbo-action";
import { GoldBeam } from "@/components/ui/GoldBeam";
import type { QboConnectionPanel } from "@/server/mission-control/qbo-connection";
import {
  btnPrimary,
  btnQuiet,
  card,
  eyebrow,
  heading,
  innerCard,
  muted,
  noticeError,
} from "./soft-ui";

const STATUS_STYLE: Record<
  QboConnectionPanel["status"],
  { className: string; hint: string }
> = {
  Connected: {
    className: "text-emerald-700",
    hint: "Access token is present for the active QBO environment.",
  },
  Expired: {
    className: "text-amber-700",
    hint: "Access token expired — reconnect or wait for keep-alive refresh.",
  },
  Disconnected: {
    className: "text-rose-700",
    hint: "No refresh token stored. Company Admin must reconnect via Intuit.",
  },
};

function formatExpires(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function QboConnectionCard() {
  const [panel, setPanel] = useState<QboConnectionPanel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const result = await getQboConnectionAction();
    if (result.ok) {
      setPanel(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const statusStyle = panel ? STATUS_STYLE[panel.status] : null;

  return (
    <div className={card} data-testid="qbo-connection-card">
      <GoldBeam active={loading} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className={eyebrow}>QuickBooks Online</div>
          <h2 className={heading}>Company Connection</h2>
          <p className={`mt-1 max-w-xl ${muted}`}>
            Register{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
              https://hub.ccpatio.com/mission-control
            </code>{" "}
            as the Intuit Developer Portal reconnect URL. Status below is the active{" "}
            <span className="font-medium text-slate-700">
              {panel?.environment ?? "…"}
            </span>{" "}
            token row only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className={btnQuiet}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <a
            href="/api/auth/qbo/connect"
            className={btnPrimary}
            data-testid="qbo-reconnect-button"
          >
            Reconnect QuickBooks
          </a>
        </div>
      </div>

      {error && <div className={`mt-4 ${noticeError}`}>{error}</div>}

      <div className={`mt-5 ${innerCard}`}>
        {loading && !panel ? (
          <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
        ) : panel ? (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className={eyebrow}>Status</dt>
              <dd
                className={`mt-1 text-sm font-semibold ${statusStyle?.className ?? ""}`}
                data-testid="qbo-connection-status"
              >
                {panel.status}
              </dd>
              <p className={`mt-1 text-xs ${muted}`}>{statusStyle?.hint}</p>
            </div>
            <div>
              <dt className={eyebrow}>Environment</dt>
              <dd className="mt-1 text-sm font-medium text-slate-800">{panel.environment}</dd>
            </div>
            <div>
              <dt className={eyebrow}>realm_id</dt>
              <dd
                className="mt-1 break-all font-mono text-xs text-slate-800"
                data-testid="qbo-realm-id"
              >
                {panel.realmId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className={eyebrow}>expires_at</dt>
              <dd
                className="mt-1 text-sm text-slate-800"
                data-testid="qbo-expires-at"
              >
                {formatExpires(panel.expiresAt)}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </div>
  );
}

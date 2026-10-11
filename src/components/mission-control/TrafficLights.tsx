"use client";

import { useEffect, useState } from "react";
import { getSystemHealthAction } from "@/app/mission-control/health-action";

type LampColor = "green" | "amber" | "red";

type TrafficLamp = {
  spoke: string;
  label: string;
  lamp: LampColor;
  detail: string;
};

const LAMP_CLASS: Record<LampColor, string> = {
  green: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]",
  amber: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]",
  red: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]",
};

export function TrafficLights() {
  const [lamps, setLamps] = useState<TrafficLamp[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchHealth() {
    setLoading(true);
    const result = await getSystemHealthAction();
    if (result.ok && result.data) {
      setLamps(result.data);
      setError(null);
    } else {
      setError(result.ok ? "Failed to load system health." : result.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchHealth();
  }, []);

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">System Health</h2>
        <button
          type="button"
          onClick={() => void fetchHealth()}
          disabled={loading}
          className="text-xs font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading && !lamps
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-zinc-900"></div>
            ))
          : lamps?.map((item) => (
              <div
                key={item.spoke}
                className="flex flex-col justify-between rounded-lg border border-zinc-800/60 bg-zinc-900/50 p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-300">{item.label}</span>
                  <div
                    role="img"
                    aria-label={`${item.label} ${item.lamp}`}
                    className={`h-3 w-3 rounded-full ${LAMP_CLASS[item.lamp]}`}
                  />
                </div>
                <div className="mt-4 text-xs text-zinc-400">{item.detail}</div>
              </div>
            ))}
      </div>
    </div>
  );
}

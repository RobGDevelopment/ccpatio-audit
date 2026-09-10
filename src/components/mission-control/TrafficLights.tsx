"use client";

import { useEffect, useState } from "react";
import { getSystemHealthAction } from "@/app/mission-control/health-action";

type HealthStatus = {
  spoke: string;
  ok: boolean;
  status: number | null;
  authFailed: boolean;
  detail: string;
};

export function TrafficLights() {
  const [healthData, setHealthData] = useState<HealthStatus[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchHealth() {
    setLoading(true);
    const result = await getSystemHealthAction();
    if (result.ok && result.data) {
      setHealthData(result.data);
      setError(null);
    } else {
      setError(result.error || "Failed to load system health.");
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchHealth();
  }, []);

  function renderStatusText(item: HealthStatus) {
    if (item.ok) return "System Healthy";
    if (item.authFailed) return "Connection Lost - Password Expired";
    return `Offline - ${item.detail}`;
  }

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">System Health</h2>
        <button
          onClick={fetchHealth}
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
        {loading && !healthData
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg bg-zinc-900 h-24"></div>
            ))
          : healthData?.map((item) => (
              <div
                key={item.spoke}
                className="flex flex-col justify-between rounded-lg border border-zinc-800/60 bg-zinc-900/50 p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-zinc-300">
                    {item.spoke === "WordPressCore" ? "WordPress" : item.spoke}
                  </span>
                  <div
                    className={`h-3 w-3 rounded-full ${
                      item.ok ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                    }`}
                  />
                </div>
                <div className="mt-4 text-xs text-zinc-400">
                  {renderStatusText(item)}
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}

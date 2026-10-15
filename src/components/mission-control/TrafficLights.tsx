"use client";

import { useEffect, useState } from "react";
import { getSystemHealthAction } from "@/app/mission-control/health-action";
import { GoldBeam } from "@/components/ui/GoldBeam";
import type { SystemLamp } from "@/server/mission-control/health-probes";
import { btnQuiet, card, eyebrow, heading, innerCard, noticeError } from "./soft-ui";

type LampColor = SystemLamp["lamp"];

const LAMP_DOT: Record<LampColor, string> = {
  green: "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.15)]",
  amber: "bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,0.2)]",
  red: "bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.15)]",
};

const LAMP_WORD: Record<LampColor, { text: string; className: string }> = {
  green: { text: "Healthy", className: "text-emerald-700" },
  amber: { text: "Watch", className: "text-amber-700" },
  red: { text: "Needs attention", className: "text-rose-700" },
};

const GROUPS: { id: SystemLamp["group"]; title: string; skeletons: number }[] = [
  { id: "core", title: "Core systems", skeletons: 4 },
  { id: "channels", title: "Sales channels", skeletons: 3 },
];

function LampCard({ item }: { item: SystemLamp }) {
  const word = LAMP_WORD[item.lamp];
  return (
    <div className={`${innerCard} flex flex-col justify-between`} data-testid={`lamp-${item.id}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-800">{item.label}</span>
        <span
          role="img"
          aria-label={`${item.label} ${item.lamp}`}
          className={`h-3 w-3 shrink-0 rounded-full ${LAMP_DOT[item.lamp]}`}
        />
      </div>
      <div className={`mt-3 text-xs font-medium ${word.className}`}>{word.text}</div>
      <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
    </div>
  );
}

export function TrafficLights() {
  const [lamps, setLamps] = useState<SystemLamp[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchHealth() {
    setLoading(true);
    const result = await getSystemHealthAction();
    if (result.ok) {
      setLamps(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchHealth();
  }, []);

  return (
    <div className={card} data-testid="system-health">
      <GoldBeam active={loading} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className={eyebrow}>Live status</div>
          <h2 className={heading}>System Health</h2>
        </div>
        <button type="button" onClick={() => void fetchHealth()} disabled={loading} className={btnQuiet}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className={`mt-4 ${noticeError}`}>{error}</div>}

      {GROUPS.map((group) => {
        const items = lamps?.filter((lamp) => lamp.group === group.id) ?? [];
        return (
          <section key={group.id} className="mt-6" aria-label={group.title}>
            <h3 className={`${eyebrow} mb-3`}>{group.title}</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {loading && !lamps
                ? Array.from({ length: group.skeletons }).map((_, i) => (
                    <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
                  ))
                : items.map((item) => <LampCard key={item.id} item={item} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

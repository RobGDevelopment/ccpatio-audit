"use client";

import { motion } from "framer-motion";
import {
  buildCustomSequence,
  describeCustomJourney,
  DEFAULT_JOURNEY_BUILDER,
  FUNNEL_OPTIONS,
  INGESTION_OPTIONS,
  REGION_OPTIONS,
  type JourneyBuilderConfig,
} from "./journeyBuilder";
import { useTopologyStore } from "./topologyStore";

type Props = {
  onStartMovie: () => void;
  onCancel: () => void;
};

export function JourneyBuilderOverlay({ onStartMovie, onCancel }: Props) {
  const config = useTopologyStore((s) => s.journeyBuilder);
  const setConfig = useTopologyStore((s) => s.setJourneyBuilder);
  const previewLen = buildCustomSequence(config).length;

  const set = <K extends keyof JourneyBuilderConfig>(
    key: K,
    value: JourneyBuilderConfig[K]
  ) => {
    setConfig({ ...config, [key]: value });
  };

  const effectiveConfig =
    config.funnel === "trade" ? { ...config, region: "ca" as const } : config;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-[#030712]/85 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.96, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        className="mx-4 w-full max-w-lg rounded-2xl border border-slate-700/80 bg-slate-950/95 p-6 shadow-2xl"
        style={{
          boxShadow:
            "0 0 0 1px rgba(34,211,238,0.15), 0 24px 80px rgba(0,0,0,0.55)",
        }}
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.35em] text-cyan-400">
          Movie Mode
        </div>
        <h2 className="mt-1 text-xl font-semibold text-slate-50">
          Build your journey
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          Select ingestion, funnel, and region. The camera will track each
          granular sub-step across the full 56-day SLA map.
        </p>

        <Section title="Ingestion source">
          <OptionGrid
            options={INGESTION_OPTIONS.map((o) => ({
              id: o.id,
              label: o.label,
            }))}
            value={config.ingestion}
            onChange={(v) => set("ingestion", v as typeof config.ingestion)}
          />
        </Section>

        <Section title="Pipeline / funnel">
          <OptionGrid
            options={FUNNEL_OPTIONS}
            value={config.funnel}
            onChange={(v) => set("funnel", v as typeof config.funnel)}
          />
        </Section>

        {config.funnel !== "warranty" ? (
          <Section title="Region">
            <OptionGrid
              options={REGION_OPTIONS}
              value={config.region}
              onChange={(v) => set("region", v as typeof config.region)}
              disabled={config.funnel === "trade"}
            />
            {config.funnel === "trade" ? (
              <p className="mt-1 text-[10px] text-slate-500">
                B2B Trade routes to Solana Beach (CA) by default.
              </p>
            ) : null}
          </Section>
        ) : null}

        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2">
          <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500">
            Route preview
          </div>
          <div className="mt-1 text-sm font-medium text-cyan-100">
            {describeCustomJourney(effectiveConfig)}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {previewLen} cinematic steps · granular sub-node docking
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onStartMovie}
            className="flex-1 rounded-xl border border-cyan-500/50 bg-cyan-500/15 px-4 py-2.5 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/25"
          >
            Start Movie
          </button>
          <button
            type="button"
            onClick={() => setConfig(DEFAULT_JOURNEY_BUILDER)}
            className="rounded-xl border border-slate-700 px-3 py-2.5 text-xs text-slate-400 hover:bg-slate-900"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-700 px-3 py-2.5 text-xs text-slate-400 hover:bg-slate-900"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function OptionGrid({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
            value === o.id
              ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-100"
              : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600"
          } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

"use client";

import { useTopologyStore } from "../topology/topologyStore";

type ExecutionStateIndicatorProps = {
  nodeId: string;
  className?: string;
  size?: "sm" | "md";
};

export function ExecutionStateIndicator({
  nodeId,
  className = "",
  size = "sm",
}: ExecutionStateIndicatorProps) {
  const executionState = useTopologyStore(
    (s) => s.nodeIntegrationConfigs[nodeId]?.executionState
  );

  if (!executionState) return null;

  const dim =
    size === "sm"
      ? "h-5 w-5 text-[11px]"
      : "h-6 w-6 text-[13px]";

  if (executionState === "automated") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-amber-400/40 bg-amber-500/15 ${dim} ${className}`}
        title="Automated / System"
        aria-label="Automated"
      >
        ⚡
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-orange-400/35 bg-orange-500/10 ${dim} ${className}`}
      title="Manual / Human"
      aria-label="Manual"
    >
      ✋
    </span>
  );
}

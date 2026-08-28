"use client";

import {
  cumulativeCalendarDays,
  E2E_SLA_DAYS,
  formatStepDelta,
  formatTimelineDay,
  formatTerminalSlaLabel,
} from "./dwellCalendar";
import type { SequenceStep } from "./sequences";

type Props = {
  steps: SequenceStep[];
  stepIndex: number;
  color: string;
  compact?: boolean;
};

export function CalendarStrip({ steps, stepIndex, color, compact }: Props) {
  const { totalMin, totalMax, current } = cumulativeCalendarDays(
    steps,
    stepIndex
  );
  const delta = formatStepDelta(current);
  const hasData = totalMin > 0 || totalMax > 0 || delta != null;
  const isTerminalStep =
    steps[stepIndex]?.nodeId === "reconciled" ||
    steps[stepIndex]?.nodeId === "postcare";

  if (!hasData && stepIndex === 0) {
    return (
      <div className="text-[10px] text-slate-500">
        Timeline · Day 0 · {E2E_SLA_DAYS}-day max E2E SLA
      </div>
    );
  }

  if (compact) {
    return (
      <div
        className="text-[10px] font-medium tabular-nums"
        style={{ color }}
        title={
          isTerminalStep
            ? formatTerminalSlaLabel(totalMax)
            : "Cumulative calendar-day estimate from journey start"
        }
      >
        {isTerminalStep
          ? formatTerminalSlaLabel(totalMax)
          : formatTimelineDay(totalMin, totalMax)}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color }}
        >
          Timeline
        </div>
        <div
          className="text-sm font-semibold tabular-nums text-slate-100"
          title="Cumulative calendar days since journey start (ops estimates)"
        >
          {isTerminalStep
            ? formatTerminalSlaLabel(totalMax)
            : formatTimelineDay(totalMin, totalMax)}
        </div>
      </div>
      {delta ? (
        <div className="mt-1 text-[10px] text-slate-400">
          This step · {delta}
        </div>
      ) : null}
      <div className="mt-1 text-[9px] text-slate-600">
        {isTerminalStep
          ? formatTerminalSlaLabel(totalMax)
          : `${E2E_SLA_DAYS}-day max E2E SLA · milestone calendar`}
      </div>
    </div>
  );
}

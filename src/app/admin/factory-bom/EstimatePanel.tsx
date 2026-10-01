"use client";

import { useEffect, useState } from "react";
import type { RecipeEstimateRow } from "./actions";
import { PIM_INPUT, tactileButton, tactileIdle, tactilePressed } from "./factory-bom-ui";

type Props = {
  estimate: RecipeEstimateRow | null;
  isPending: boolean;
  onRecalculate: (forceOps: boolean) => void;
  onSaveOverrides: (patch: {
    weightLbs?: number;
    dimWeightLbs?: number;
    laborMinutes?: number;
    includePackagingBom?: boolean;
    applyEstimatedWeight?: boolean;
  }) => void;
};

function displayNum(
  override: number | undefined,
  estimated: string | null,
): string {
  if (override != null && Number.isFinite(override)) return String(override);
  if (estimated == null || estimated === "") return "—";
  const n = Number(estimated);
  return Number.isFinite(n) ? n.toFixed(1) : estimated;
}

export function EstimatePanel({
  estimate,
  isPending,
  onRecalculate,
  onSaveOverrides,
}: Props) {
  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState("");
  const [dimWeight, setDimWeight] = useState("");
  const [labor, setLabor] = useState("");
  const [includePack, setIncludePack] = useState(false);
  const [applyWeight, setApplyWeight] = useState(false);

  useEffect(() => {
    if (!estimate) {
      setWeight("");
      setDimWeight("");
      setLabor("");
      setIncludePack(false);
      setApplyWeight(false);
      return;
    }
    setWeight(
      estimate.overrides.weightLbs != null
        ? String(estimate.overrides.weightLbs)
        : estimate.estWeightLbs ?? "",
    );
    setDimWeight(
      estimate.overrides.dimWeightLbs != null
        ? String(estimate.overrides.dimWeightLbs)
        : estimate.estDimWeightLbs ?? "",
    );
    setLabor(
      estimate.overrides.laborMinutes != null
        ? String(estimate.overrides.laborMinutes)
        : estimate.estLaborMinutes ?? "",
    );
    setIncludePack(Boolean(estimate.overrides.includePackagingBom));
    setApplyWeight(Boolean(estimate.overrides.applyEstimatedWeight));
  }, [estimate]);

  const chipWeight = displayNum(
    estimate?.overrides.weightLbs,
    estimate?.estWeightLbs ?? null,
  );
  const chipDim = displayNum(
    estimate?.overrides.dimWeightLbs,
    estimate?.estDimWeightLbs ?? null,
  );
  const chipLabor = displayNum(
    estimate?.overrides.laborMinutes,
    estimate?.estLaborMinutes ?? null,
  );
  const chipPackCost =
    estimate?.estPackagingCost != null
      ? `$${Number(estimate.estPackagingCost).toFixed(2)}`
      : "—";

  const breakdown = estimate?.weightBreakdown ?? {};

  return (
    <div className="mt-3 space-y-2" data-testid="factory-bom-estimate-panel">
      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`rounded-lg px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide ${
            open ? tactilePressed : tactileIdle
          }`}
        >
          AI Estimate
        </button>
        <span className={`${tactileIdle} rounded-lg px-3 py-1.5 font-mono text-[11px]`}>
          Ship {chipWeight} lb
        </span>
        <span className={`${tactileIdle} rounded-lg px-3 py-1.5 font-mono text-[11px]`}>
          DIM {chipDim} lb
        </span>
        <span className={`${tactileIdle} rounded-lg px-3 py-1.5 font-mono text-[11px]`}>
          Labor {chipLabor} min
        </span>
        <span className={`${tactileIdle} rounded-lg px-3 py-1.5 font-mono text-[11px]`}>
          Pack {chipPackCost}
        </span>
      </div>

      {open ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs text-slate-800">
          {!estimate ? (
            <p className="text-slate-500">
              No estimate yet. Recalculate from draft geometry.
            </p>
          ) : (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(
                  [
                    ["metal", breakdown.metal],
                    ["foam", breakdown.foam],
                    ["fabric", breakdown.fabric],
                    ["powder", breakdown.powder],
                    ["hardware", breakdown.hardware],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-slate-100 bg-white px-2 py-1">
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">
                      {label}
                    </div>
                    <div className="font-mono text-slate-800">
                      {value != null ? Number(value).toFixed(2) : "—"} lb
                    </div>
                  </div>
                ))}
              </div>

              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                <label className="block">
                  <span className="text-[10px] uppercase text-slate-500">
                    Override weight (lb)
                  </span>
                  <input
                    className={`${PIM_INPUT} mt-1 w-full`}
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    onBlur={() => {
                      const n = Number(weight);
                      if (!Number.isFinite(n)) return;
                      onSaveOverrides({ weightLbs: n });
                    }}
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase text-slate-500">
                    Override DIM (lb)
                  </span>
                  <input
                    className={`${PIM_INPUT} mt-1 w-full`}
                    value={dimWeight}
                    onChange={(e) => setDimWeight(e.target.value)}
                    onBlur={() => {
                      const n = Number(dimWeight);
                      if (!Number.isFinite(n)) return;
                      onSaveOverrides({ dimWeightLbs: n });
                    }}
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase text-slate-500">
                    Override labor (min)
                  </span>
                  <input
                    className={`${PIM_INPUT} mt-1 w-full`}
                    value={labor}
                    onChange={(e) => setLabor(e.target.value)}
                    onBlur={() => {
                      const n = Number(labor);
                      if (!Number.isFinite(n)) return;
                      onSaveOverrides({ laborMinutes: n });
                    }}
                  />
                </label>
              </div>

              <div className="mb-3 flex flex-col gap-2">
                <label className="flex items-center gap-2 text-slate-600">
                  <input
                    type="checkbox"
                    checked={includePack}
                    disabled={isPending}
                    onChange={(e) => {
                      setIncludePack(e.target.checked);
                      onSaveOverrides({ includePackagingBom: e.target.checked });
                    }}
                  />
                  Include packaging BOM on Approve
                </label>
                <label className="flex items-center gap-2 text-slate-600">
                  <input
                    type="checkbox"
                    checked={applyWeight}
                    disabled={isPending}
                    onChange={(e) => {
                      setApplyWeight(e.target.checked);
                      onSaveOverrides({
                        applyEstimatedWeight: e.target.checked,
                      });
                    }}
                  />
                  Apply estimated weight to FG catalog on Approve
                </label>
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isPending}
              data-testid="factory-bom-recalculate-estimates"
              onClick={() => onRecalculate(false)}
              className={`${tactileButton} px-3 py-1.5 text-xs disabled:opacity-40`}
            >
              Recalculate from geometry
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (
                  !window.confirm(
                    "Force-overwrite manager-edited operation times?",
                  )
                ) {
                  return;
                }
                onRecalculate(true);
              }}
              className={`${tactileButton} px-3 py-1.5 text-xs disabled:opacity-40`}
            >
              Force recalculate ops
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { getHygieneRadarAction, patchHygieneAction } from "@/app/mission-control/hygiene-action";
import { GoldBeam } from "@/components/ui/GoldBeam";
import type {
  DimensionField,
  HygieneIssue,
  HygieneItem,
  RadarResult,
} from "@/server/mission-control/hygiene";
import {
  badge,
  btnGhost,
  btnPrimary,
  btnQuiet,
  card,
  eyebrow,
  field,
  heading,
  innerCard,
  muted,
  noticeError,
} from "./soft-ui";

// Client-side copies of the labels: the server module pulls in the database and cannot be imported here
// at runtime. Only types come from it.
const ISSUE_LABEL: Record<HygieneIssue, string> = {
  missing_msrp: "Missing MSRP",
  blank_dimensions: "Blank dimensions",
  missing_3d_asset: "Missing 3D asset",
};

const ISSUE_BADGE: Record<HygieneIssue, string> = {
  missing_msrp: "bg-rose-50 text-rose-700 ring-rose-100",
  blank_dimensions: "bg-amber-50 text-amber-700 ring-amber-100",
  missing_3d_asset: "bg-sky-50 text-sky-700 ring-sky-100",
};

const DIMENSIONS: readonly DimensionField[] = ["length", "depth", "height"];

const NUMBER_PATTERN = /^\d+(\.\d{1,2})?$/;

function prefill(value: string | null): string {
  return value !== null && NUMBER_PATTERN.test(value.trim()) && Number(value) > 0 ? value.trim() : "";
}

type FormState = {
  msrp: string;
  values: Record<DimensionField, string>;
  na: Record<DimensionField, boolean>;
};

function initialForm(item: HygieneItem): FormState {
  return {
    msrp: prefill(item.msrp),
    values: {
      length: prefill(item.length),
      depth: prefill(item.depth),
      height: prefill(item.height),
    },
    na: {
      length: item.notApplicable.includes("length"),
      depth: item.notApplicable.includes("depth"),
      height: item.notApplicable.includes("height"),
    },
  };
}

function QuickAccessForm({
  item,
  onCancel,
  onSaved,
}: {
  item: HygieneItem;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(item));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await patchHygieneAction({
      sku: item.sku,
      msrp: form.msrp,
      length: form.na.length ? "" : form.values.length,
      depth: form.na.depth ? "" : form.values.depth,
      height: form.na.height ? "" : form.values.height,
      notApplicable: DIMENSIONS.filter((dimension) => form.na[dimension]),
    });
    setPending(false);
    if (result.ok) {
      onSaved();
      return;
    }
    setError(result.error);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 p-6">
      <div>
        <div className={eyebrow}>Quick access</div>
        <h2 id="hygiene-modal-title" className={heading}>
          {item.name}
        </h2>
        <p className="mt-0.5 font-mono text-xs text-slate-500">{item.sku}</p>
      </div>

      <div>
        <label htmlFor="hygiene-msrp" className={eyebrow}>
          MSRP (USD)
        </label>
        <input
          id="hygiene-msrp"
          inputMode="decimal"
          autoComplete="off"
          value={form.msrp}
          onChange={(event) => setForm({ ...form, msrp: event.target.value })}
          placeholder="e.g. 1299.00"
          className={`mt-1.5 ${field}`}
        />
      </div>

      <fieldset>
        <legend className={eyebrow}>Dimensions (inches)</legend>
        <div className="mt-1.5 grid grid-cols-3 gap-3">
          {DIMENSIONS.map((dimension) => (
            <div key={dimension}>
              <label htmlFor={`hygiene-${dimension}`} className="text-xs capitalize text-slate-600">
                {dimension}
              </label>
              <input
                id={`hygiene-${dimension}`}
                inputMode="decimal"
                autoComplete="off"
                disabled={form.na[dimension]}
                value={form.na[dimension] ? "" : form.values[dimension]}
                onChange={(event) =>
                  setForm({ ...form, values: { ...form.values, [dimension]: event.target.value } })
                }
                className={`mt-1 ${field} disabled:opacity-40`}
              />
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                <input
                  type="checkbox"
                  checked={form.na[dimension]}
                  onChange={(event) =>
                    setForm({ ...form, na: { ...form.na, [dimension]: event.target.checked } })
                  }
                  className="h-3.5 w-3.5 rounded accent-[#C5A059]"
                />
                N/A
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className={innerCard}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-slate-800">3D asset</span>
          <span
            className={`${badge} ${item.has3d ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : ISSUE_BADGE.missing_3d_asset}`}
          >
            {item.has3d ? "On file" : "Missing"}
          </span>
        </div>
        {!item.has3d && (
          <p className="mt-2 text-xs text-slate-500">
            A model is uploaded with the product logistics profile, not here.{" "}
            <a href="/admin/logistics" className="font-medium text-slate-900 underline underline-offset-2">
              Open logistics
            </a>
          </p>
        )}
      </div>

      {error ? (
        <p role="alert" className={noticeError}>
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={pending} className={btnGhost}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function QuickAccessDialog({
  item,
  onClose,
  onSaved,
}: {
  item: HygieneItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="hygiene-modal-title"
      data-testid="hygiene-modal"
      onClose={onClose}
      className="m-auto w-full max-w-lg rounded-2xl bg-white p-0 text-slate-900 shadow-[0_24px_60px_rgb(0,0,0,0.12)] backdrop:bg-slate-900/30 backdrop:backdrop-blur-sm"
    >
      {/* Keyed by SKU so every product opens with fresh form state. */}
      {item ? <QuickAccessForm key={item.sku} item={item} onCancel={onClose} onSaved={onSaved} /> : null}
    </dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`${innerCard} flex-1 min-w-[8rem]`}>
      <div className={`text-2xl font-semibold tracking-tight ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </div>
  );
}

export function HygieneRadar() {
  const [radar, setRadar] = useState<RadarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HygieneItem | null>(null);

  const scan = useCallback(async () => {
    setLoading(true);
    const result = await getHygieneRadarAction();
    if (result.ok) {
      setRadar(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  return (
    <div className={card} data-testid="hygiene-radar">
      <GoldBeam active={loading} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className={eyebrow}>Quote readiness</div>
          <h2 className={heading}>Catalog Hygiene Radar</h2>
          <p className={`mt-1 ${muted}`}>
            Products that would stall or weaken a quote: no price, blank dimensions, or no 3D asset.
          </p>
        </div>
        <button type="button" onClick={() => void scan()} disabled={loading} className={btnQuiet}>
          {loading ? "Scanning..." : "Rescan"}
        </button>
      </div>

      {error && <p className={`mt-4 ${noticeError}`}>{error}</p>}

      {radar && (
        <>
          <div className="mt-5 flex flex-wrap gap-3">
            <Stat label="Flagged products" value={radar.totals.flagged} tone="text-slate-900" />
            <Stat label="Missing MSRP" value={radar.totals.missingMsrp} tone="text-rose-600" />
            <Stat label="Blank dimensions" value={radar.totals.blankDimensions} tone="text-amber-600" />
            <Stat label="Missing 3D asset" value={radar.totals.missing3d} tone="text-sky-600" />
          </div>

          {radar.items.length === 0 ? (
            <p className="mt-6 text-sm text-emerald-700">
              All {radar.scanned} active products are quote-ready.
            </p>
          ) : (
            <ul className="mt-6 divide-y divide-slate-100">
              {radar.items.map((item) => (
                <li
                  key={item.sku}
                  data-testid={`hygiene-row-${item.sku}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{item.name}</div>
                    <div className="mt-0.5 font-mono text-xs text-slate-500">{item.sku}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.issues.map((issue) => (
                        <span key={issue} className={`${badge} ${ISSUE_BADGE[issue]}`}>
                          {ISSUE_LABEL[issue]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid={`hygiene-quick-access-${item.sku}`}
                    onClick={() => setSelected(item)}
                    className={btnGhost}
                  >
                    Quick access
                  </button>
                </li>
              ))}
            </ul>
          )}

          {radar.truncated && (
            <p className={`mt-4 ${muted}`}>
              Showing the {radar.items.length} worst of {radar.totals.flagged} flagged products.
            </p>
          )}
        </>
      )}

      <QuickAccessDialog
        item={selected}
        onClose={() => setSelected(null)}
        onSaved={() => {
          setSelected(null);
          void scan();
        }}
      />
    </div>
  );
}

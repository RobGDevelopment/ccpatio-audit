"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useToast } from "@/app/admin/shared/ToastProvider";
import { useModalA11y } from "@/app/admin/shared/useModalA11y";
import { LTL_FREIGHT_CLASSES } from "@/lib/logistics-profile";
import {
  upsertLogisticsProfile,
  type LogisticsProfileRow,
} from "@/server/actions/logistics";

type Props = {
  row: LogisticsProfileRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: (profile: LogisticsProfileRow) => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

type Draft = {
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  weightLb: string;
  ltlClass: string;
  asset3dUrl: string;
  isModularComponent: boolean;
  leadTimeDays: string;
};

function draftFromRow(row: LogisticsProfileRow): Draft {
  return {
    lengthIn: row.lengthIn ?? "",
    widthIn: row.widthIn ?? "",
    heightIn: row.heightIn ?? "",
    weightLb: row.weightLb ?? "",
    ltlClass: row.ltlClass ?? "",
    asset3dUrl: row.asset3dUrl ?? "",
    isModularComponent: row.isModularComponent,
    leadTimeDays: row.leadTimeDays == null ? "" : String(row.leadTimeDays),
  };
}

export function LogisticsProfileSheet({
  row,
  open,
  onClose,
  onSaved,
  returnFocusRef,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open || !row) {
      setDraft(null);
      setError(null);
      return;
    }
    setDraft(draftFromRow(row));
    setError(null);
  }, [open, row]);

  useModalA11y({
    open: open && row !== null,
    onClose,
    containerRef: panelRef,
    returnFocusRef,
  });

  if (!open || !row || !draft) return null;

  const save = () => {
    startTransition(async () => {
      const result = await upsertLogisticsProfile({
        katanaVariantId: row.katanaVariantId,
        variantSku: row.variantSku,
        lengthIn: draft.lengthIn,
        widthIn: draft.widthIn,
        heightIn: draft.heightIn,
        weightLb: draft.weightLb,
        ltlClass: draft.ltlClass,
        asset3dUrl: draft.asset3dUrl,
        leadTimeDays: draft.leadTimeDays,
        isModularComponent: draft.isModularComponent,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      onSaved(result.profile);
      toast.success(`Saved ${result.profile.variantSku}`);
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close logistics profile"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="logistics-profile-title"
        tabIndex={-1}
        className="pim-glass relative z-10 flex h-full w-full max-w-md flex-col border-l border-zinc-700/80 shadow-2xl shadow-black/60 outline-none"
      >
        <header className="shrink-0 border-b border-zinc-800 px-5 py-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
            Logistics profile
          </p>
          <h2
            id="logistics-profile-title"
            className="mt-1 font-mono text-lg font-semibold text-zinc-50"
          >
            {row.variantSku}
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Katana variant {row.katanaVariantId}. SKU and variant id stay with
            Katana. Saving writes length, width, height, weight, NMFC class, and
            lead time on this profile.
          </p>
        </header>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!isPending) save();
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Length (in)"
                name="length"
                value={draft.lengthIn}
                onChange={(lengthIn) => setDraft({ ...draft, lengthIn })}
              />
              <Field
                label="Width (in)"
                name="width"
                value={draft.widthIn}
                onChange={(widthIn) => setDraft({ ...draft, widthIn })}
              />
              <Field
                label="Height (in)"
                name="height"
                value={draft.heightIn}
                onChange={(heightIn) => setDraft({ ...draft, heightIn })}
              />
              <Field
                label="Weight (lb)"
                name="weight"
                value={draft.weightLb}
                onChange={(weightLb) => setDraft({ ...draft, weightLb })}
              />
            </div>

            <label className="block text-xs text-zinc-400">
              Lead time (days)
              <input
                name="lead_time_days"
                data-testid="logistics-lead-time"
                value={draft.leadTimeDays}
                onChange={(event) =>
                  setDraft({ ...draft, leadTimeDays: event.target.value })
                }
                inputMode="numeric"
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/70"
              />
            </label>

            <label className="block text-xs text-zinc-400">
              NMFC class
              <select
                name="nmfc_class"
                data-testid="logistics-nmfc-class"
                value={draft.ltlClass}
                onChange={(event) =>
                  setDraft({ ...draft, ltlClass: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/70"
              >
                <option value="">Select class</option>
                {LTL_FREIGHT_CLASSES.map((freightClass) => (
                  <option key={freightClass} value={freightClass}>
                    {freightClass}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-zinc-400">
              3D asset URL
              <input
                type="text"
                value={draft.asset3dUrl}
                placeholder="https://…/model.glb"
                onChange={(event) =>
                  setDraft({ ...draft, asset3dUrl: event.target.value })
                }
                className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-emerald-500/70"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={draft.isModularComponent}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    isModularComponent: event.target.checked,
                  })
                }
                className="size-4 accent-emerald-500"
              />
              Modular component
            </label>

            {error ? (
              <p className="text-sm text-rose-300" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-800 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Save profile"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs text-zinc-400">
      {label}
      <input
        name={name}
        data-testid={`logistics-${name}`}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm tabular-nums text-zinc-100 outline-none focus:border-emerald-500/70"
      />
    </label>
  );
}

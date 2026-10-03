"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/app/admin/shared/ToastProvider";
import {
  updateLogisticsSettings,
  type LogisticsSettings,
} from "@/server/actions/logistics";

type Props = {
  settings: LogisticsSettings;
  canSave: boolean;
};

type Draft = {
  localWhiteGloveFee: string;
  localRadiusMiles: string;
  fleetMaxRadiusMiles: string;
  ltlHandlingMarkupPct: string;
  fleetBaseFee: string;
  fleetPerMile: string;
  fleetPerPound: string;
  fleetTransitDays: string;
  depositPct: string;
};

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function draftFromSettings(settings: LogisticsSettings): Draft {
  return {
    localWhiteGloveFee: settings.localWhiteGloveFee.toFixed(2),
    localRadiusMiles: String(settings.localRadiusMiles),
    fleetMaxRadiusMiles: String(settings.fleetMaxRadiusMiles),
    ltlHandlingMarkupPct: settings.ltlHandlingMarkupPct.toFixed(2),
    fleetBaseFee: settings.fleetBaseFee == null ? "" : settings.fleetBaseFee.toFixed(2),
    fleetPerMile: settings.fleetPerMile == null ? "" : settings.fleetPerMile.toFixed(2),
    fleetPerPound:
      settings.fleetPerPound == null ? "" : settings.fleetPerPound.toFixed(4),
    fleetTransitDays: String(settings.fleetTransitDays),
    depositPct: settings.depositPct.toFixed(2),
  };
}

function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return Number(trimmed);
}

export function DeliverySettingsCard({ settings, canSave }: Props) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftFromSettings(settings));
  const [updatedAt, setUpdatedAt] = useState(settings.updatedAt);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startSave] = useTransition();

  const save = () => {
    setError(null);
    startSave(async () => {
      const result = await updateLogisticsSettings({
        localWhiteGloveFee: Number(draft.localWhiteGloveFee),
        localRadiusMiles: Number(draft.localRadiusMiles),
        fleetMaxRadiusMiles: Number(draft.fleetMaxRadiusMiles),
        ltlHandlingMarkupPct: Number(draft.ltlHandlingMarkupPct),
        fleetBaseFee: optionalNumber(draft.fleetBaseFee),
        fleetPerMile: optionalNumber(draft.fleetPerMile),
        fleetPerPound: optionalNumber(draft.fleetPerPound),
        fleetTransitDays: Number(draft.fleetTransitDays),
        depositPct: Number(draft.depositPct),
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      setDraft(draftFromSettings(result.settings));
      setUpdatedAt(result.settings.updatedAt);
      toast.success("Delivery settings saved");
    });
  };

  return (
    <section className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950/70 px-4 py-4 sm:px-5">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
            Delivery &amp; Fulfillment Settings
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-zinc-400">
            Inside the local radius, delivery is white-glove at the fee below.
            Out to the fleet max, the company truck is base fee plus per-mile
            and per-pound. Leave those three blank until the tariff is set; a
            blank tariff refuses the truck. Past the fleet max, the order is
            Priority1 only. Handling markup is added to the broker&apos;s all-in
            rate.
          </p>
        </div>
        <p className="text-xs text-zinc-500">
          Updated {formatUpdated(updatedAt)}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Field
          label="Local White-Glove Fee ($)"
          value={draft.localWhiteGloveFee}
          min={0}
          step="0.01"
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, localWhiteGloveFee: value }))
          }
        />
        <Field
          label="Local Radius (Miles)"
          value={draft.localRadiusMiles}
          min={1}
          step="1"
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, localRadiusMiles: value }))
          }
        />
        <Field
          label="Internal Fleet Max Radius (Miles)"
          value={draft.fleetMaxRadiusMiles}
          min={1}
          step="1"
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, fleetMaxRadiusMiles: value }))
          }
        />
        <Field
          label="LTL Handling Markup (%)"
          value={draft.ltlHandlingMarkupPct}
          min={0}
          step="0.01"
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, ltlHandlingMarkupPct: value }))
          }
        />
        <Field
          label="Fleet Base Fee ($)"
          value={draft.fleetBaseFee}
          min={0}
          step="0.01"
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, fleetBaseFee: value }))
          }
        />
        <Field
          label="Fleet Per Mile ($)"
          value={draft.fleetPerMile}
          min={0}
          step="0.01"
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, fleetPerMile: value }))
          }
        />
        <Field
          label="Fleet Per Pound ($)"
          value={draft.fleetPerPound}
          min={0}
          step="0.0001"
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, fleetPerPound: value }))
          }
        />
        <Field
          label="Fleet Transit Days"
          value={draft.fleetTransitDays}
          min={0}
          step="1"
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, fleetTransitDays: value }))
          }
        />
        <Field
          label="Deposit (%)"
          value={draft.depositPct}
          min={0.01}
          step="0.01"
          onChange={(value) =>
            setDraft((prev) => ({ ...prev, depositPct: value }))
          }
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!canSave || isPending}
          className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save Settings"}
        </button>
        {!canSave ? (
          <p className="text-sm text-amber-200">Sign in to save settings.</p>
        ) : null}
        {error ? (
          <p className="text-sm text-rose-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  step: string;
  onChange: (value: string) => void;
}) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm tabular-nums text-zinc-100 outline-none focus:border-emerald-500/70"
      />
    </label>
  );
}

"use client";

import {
  isNaToken,
  type ProductFieldDescriptor,
} from "@/app/admin/dictionary/pim-catalog-utils";
import { resolveSmartFieldMeta } from "./smart-field-config";

type Props = {
  field: ProductFieldDescriptor;
  value: string;
  disabled?: boolean;
  fieldError?: string;
  /** When true, empty required fields show red; complete fields show green. */
  showValidationState?: boolean;
  onChange: (value: string) => void;
  onMarkNa?: () => void;
};

export function isSmartFieldComplete(
  field: ProductFieldDescriptor,
  value: string,
): boolean {
  if (isNaToken(value)) return field.allowNa;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const meta = resolveSmartFieldMeta(field.key, field.patchField);
  if (meta.kind === "number") {
    return /^\d+(\.\d+)?$/.test(trimmed);
  }
  if (meta.kind === "select") {
    return Boolean(meta.options?.includes(trimmed));
  }
  return true;
}

export function SmartFieldInput({
  field,
  value,
  disabled = false,
  fieldError,
  showValidationState = false,
  onChange,
  onMarkNa,
}: Props) {
  const meta = resolveSmartFieldMeta(field.key, field.patchField);
  const looksNa = isNaToken(value);
  const isEmpty = !looksNa && !value.trim();
  const isComplete = isSmartFieldComplete(field, value);
  const highlightMissing =
    showValidationState && !fieldError && !looksNa && !isComplete;
  const highlightValid =
    showValidationState && !fieldError && isComplete && !looksNa;

  const stateClass = fieldError || highlightMissing
    ? "pim-input-missing"
    : highlightValid
      ? "pim-input-valid"
      : looksNa
        ? "pim-input-na"
        : "";

  const controlClass = `pim-input min-w-0 flex-1 py-2 text-sm ${stateClass}`;

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
      <span className="min-w-[7rem] shrink-0 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {field.label}
        {showValidationState ? (
          <span className="ml-1 text-rose-400/80" aria-hidden>
            *
          </span>
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {meta.kind === "select" ? (
            <select
              value={looksNa ? "" : value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              className={`${controlClass} appearance-none`}
            >
              <option value="" className="bg-slate-950">
                Select…
              </option>
              {meta.options?.map((opt) => (
                <option key={opt} value={opt} className="bg-slate-950">
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={meta.kind === "number" ? "number" : "text"}
              step={meta.step}
              min={meta.min}
              value={value}
              disabled={disabled}
              placeholder={meta.kind === "number" ? "0.00" : "Enter value"}
              onChange={(e) => onChange(e.target.value)}
              className={`${controlClass}${meta.kind === "number" ? " font-mono" : ""}`}
            />
          )}
          {field.allowNa && onMarkNa ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onMarkNa}
              className="shrink-0 rounded border border-slate-700/60 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 transition hover:border-slate-600 hover:text-slate-300 disabled:opacity-50"
            >
              Mark N/A
            </button>
          ) : null}
        </div>
        {fieldError ? (
          <p className="mt-1 text-[11px] text-rose-400">{fieldError}</p>
        ) : highlightMissing && isEmpty ? (
          <p className="mt-1 text-[11px] text-rose-400/70">Required</p>
        ) : null}
      </div>
    </div>
  );
}

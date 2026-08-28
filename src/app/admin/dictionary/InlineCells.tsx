"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  patchAttributeField,
  patchCatalogField,
  patchMappingField,
  saveCatalogDraft,
  setCatalogFieldNotApplicable,
} from "./actions";
import { isNaToken } from "./pim-catalog-utils";

const OPERATOR_KEY = "ccpatio_pim_operator";

export function getOperatorName(): string {
  if (typeof window === "undefined") return "operator";
  const existing = window.localStorage.getItem(OPERATOR_KEY)?.trim();
  if (existing) return existing;
  const generated = `Device-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  window.localStorage.setItem(OPERATOR_KEY, generated);
  return generated;
}

export function setOperatorName(name: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OPERATOR_KEY, name.trim() || "operator");
}

type SaveState = "idle" | "saving" | "saved" | "error";

export type InlineSaveMeta = {
  value: string;
  updatedAt: string;
  updatedBy: string | null;
  version: number;
  naFields?: string[];
};

type InlineTextCellProps = {
  globalSku: string;
  field: string;
  value: string;
  target: "catalog" | "mapping" | "attribute";
  expectedVersion?: number;
  /** Accept "N/A" → na_fields for catalog dimension fields */
  allowNa?: boolean;
  placeholder?: string;
  className?: string;
  variant?: "boxed" | "plain";
  highlightMissing?: boolean;
  disabled?: boolean;
  onSaved?: (meta: InlineSaveMeta) => void;
  onConflict?: () => void;
};

export function InlineTextCell({
  globalSku,
  field,
  value,
  target,
  expectedVersion,
  allowNa = false,
  placeholder = "—",
  className = "",
  variant = "boxed",
  highlightMissing = false,
  disabled = false,
  onSaved,
  onConflict,
}: InlineTextCellProps) {
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const lastSaved = useRef(value);

  useEffect(() => {
    if (value !== lastSaved.current && saveState !== "saving") {
      setDraft(value);
      lastSaved.current = value;
    }
  }, [value, saveState]);

  const looksNa = allowNa && isNaToken(draft);
  const isEmpty = !looksNa && !draft.trim();
  const inputClass =
    variant === "plain" ? "pim-input-plain" : "pim-input";

  const persist = useCallback(() => {
    if (disabled) return;
    if (draft === lastSaved.current) return;

    setSaveState("saving");
    setError(null);
    const operator = getOperatorName();
    const nextValue =
      allowNa && isNaToken(draft) ? "N/A" : draft;

    startTransition(async () => {
      const result =
        target === "catalog"
          ? await patchCatalogField({
              globalSku,
              field,
              value: nextValue,
              updatedBy: operator,
            })
          : target === "mapping"
            ? await patchMappingField({
                globalSku,
                field,
                value: nextValue,
                updatedBy: operator,
                expectedVersion,
              })
            : await patchAttributeField({
                globalSku,
                path: field,
                value: nextValue,
                updatedBy: operator,
                expectedVersion,
              });

      if (!result.ok) {
        setSaveState("error");
        setError(result.error);
        if (result.code === "VERSION_CONFLICT") {
          onConflict?.();
        }
        return;
      }

      const savedDisplay =
        allowNa && result.naFields?.includes(field) ? "N/A" : nextValue;
      lastSaved.current = savedDisplay;
      setDraft(savedDisplay);
      setSaveState("saved");
      onSaved?.({
        value: savedDisplay,
        updatedAt: result.updatedAt,
        updatedBy: result.updatedBy,
        version: result.version,
        naFields: result.naFields,
      });
      window.setTimeout(() => setSaveState("idle"), 1200);
    });
  }, [
    allowNa,
    disabled,
    draft,
    expectedVersion,
    field,
    globalSku,
    onConflict,
    onSaved,
    target,
  ]);

  return (
    <div
      className={`relative ${variant === "plain" ? "min-w-0" : "min-w-[4.5rem]"} ${className}`}
    >
      <input
        value={draft}
        disabled={disabled || isPending}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={persist}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(lastSaved.current);
            e.currentTarget.blur();
          }
        }}
        className={`${inputClass} ${looksNa ? "pim-input-na" : ""} ${
          highlightMissing && isEmpty ? "pim-input-missing" : ""
        } ${
          saveState === "saved"
            ? "border-emerald-500/50"
            : saveState === "error"
              ? "border-rose-500/50"
              : ""
        }`}
        title={
          looksNa
            ? "Not applicable — counted as complete for health checks"
            : (error ?? undefined)
        }
      />
      <span className="pointer-events-none absolute top-1.5 right-1.5">
        {saveState === "saving" || isPending ? (
          <span className="pim-spinner" aria-label="Saving" />
        ) : saveState === "saved" ? (
          <span className="text-[10px] text-emerald-400" aria-label="Saved">
            ✓
          </span>
        ) : null}
      </span>
    </div>
  );
}

type EditableSelectCellProps = {
  globalSku: string;
  field: string;
  value: string;
  options: ReadonlyArray<string | { value: string; label: string }>;
  target: "mapping" | "attribute" | "catalog";
  expectedVersion?: number;
  emptyLabel?: string;
  allowEmpty?: boolean;
  allowNa?: boolean;
  highlightMissing?: boolean;
  confirmLeavingFinishedGood?: boolean;
  className?: string;
  compact?: boolean;
  onSaved?: (meta: InlineSaveMeta) => void;
  onConflict?: () => void;
};

function optionValue(
  option: string | { value: string; label: string },
): string {
  return typeof option === "string" ? option : option.value;
}

function optionLabel(
  option: string | { value: string; label: string },
): string {
  return typeof option === "string" ? option : option.label;
}

/**
 * Strict dropdown with OCC autosave (on change / blur-equivalent).
 * Use for constrained PIM lists (UOM, item_type, fabric grade, alloy, …).
 */
export function EditableSelectCell({
  globalSku,
  field,
  value,
  options,
  target,
  expectedVersion,
  emptyLabel = "—",
  allowEmpty = true,
  allowNa = false,
  highlightMissing = false,
  confirmLeavingFinishedGood = false,
  className = "",
  compact = false,
  onSaved,
  onConflict,
}: EditableSelectCellProps) {
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function persist(next: string): void {
    const normalized =
      allowNa && isNaToken(next) ? "N/A" : next;
    if (normalized === value) return;

    if (
      confirmLeavingFinishedGood &&
      value.trim().toLowerCase() === "finished good" &&
      next.trim().toLowerCase() !== "finished good" &&
      !window.confirm(
        "Changing this category will hide it from the PIM finished-good workflow. Proceed?",
      )
    ) {
      setDraft(value);
      return;
    }

    setSaveState("saving");
    setError(null);
    const operator = getOperatorName();

    startTransition(async () => {
      const result =
        target === "catalog"
          ? await patchCatalogField({
              globalSku,
              field,
              value: next,
              updatedBy: operator,
            })
          : target === "mapping"
            ? await patchMappingField({
                globalSku,
                field,
                value: next,
                updatedBy: operator,
                expectedVersion,
              })
            : await patchAttributeField({
                globalSku,
                path: field,
                value: normalized,
                updatedBy: operator,
                expectedVersion,
              });

      if (!result.ok) {
        setDraft(value);
        setSaveState("error");
        setError(result.error);
        if (result.code === "VERSION_CONFLICT") onConflict?.();
        return;
      }

      setSaveState("saved");
      setDraft(normalized);
      onSaved?.({
        value: normalized,
        updatedAt: result.updatedAt,
        updatedBy: result.updatedBy,
        version: result.version,
        naFields: result.naFields,
      });
      window.setTimeout(() => setSaveState("idle"), 1200);
    });
  }

  const known = new Set(options.map(optionValue));
  const showOrphan = draft.length > 0 && !known.has(draft);
  const looksNa = allowNa && isNaToken(draft);
  const isEmpty = !looksNa && !draft.trim();

  return (
    <div
      className={`relative ${compact ? "min-w-[2.75rem] max-w-[3.5rem]" : "min-w-[6.5rem]"} ${className}`}
    >
      <select
        value={draft}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          persist(next);
        }}
        className={`pim-input appearance-none pr-5 ${compact ? "px-1 text-[10px]" : "pr-6"} ${
          looksNa ? "pim-input-na" : ""
        } ${highlightMissing && isEmpty ? "pim-input-missing" : ""} ${
          saveState === "saved"
            ? "border-emerald-500/50"
            : saveState === "error"
              ? "border-rose-500/50"
              : ""
        }`}
        title={error ?? undefined}
      >
        {allowEmpty ? (
          <option value="" className="bg-slate-950">
            {emptyLabel}
          </option>
        ) : null}
        {showOrphan ? (
          <option value={draft} className="bg-slate-950">
            {draft} (current)
          </option>
        ) : null}
        {options.map((option) => {
          const v = optionValue(option);
          return (
            <option key={v} value={v} className="bg-slate-950">
              {optionLabel(option)}
            </option>
          );
        })}
      </select>
      {saveState === "saving" || isPending ? (
        <span className="pointer-events-none absolute top-1.5 right-1.5">
          <span className="pim-spinner" />
        </span>
      ) : null}
    </div>
  );
}

/** @deprecated Prefer EditableSelectCell — kept for call-site compatibility. */
export function InlineCategoryCell({
  globalSku,
  value,
  options,
  expectedVersion,
  onSaved,
  onConflict,
}: {
  globalSku: string;
  value: string;
  options: string[];
  expectedVersion?: number;
  onSaved?: (meta: InlineSaveMeta & { value: string }) => void;
  onConflict?: () => void;
}) {
  return (
    <EditableSelectCell
      globalSku={globalSku}
      field="category"
      value={value}
      options={options}
      target="mapping"
      expectedVersion={expectedVersion}
      allowEmpty={false}
      confirmLeavingFinishedGood
      onSaved={onSaved}
      onConflict={onConflict}
    />
  );
}

export function formatAuditStamp(
  updatedBy: string | null | undefined,
  updatedAt: string | null | undefined,
): string {
  if (!updatedAt && !updatedBy) return "—";
  const when = updatedAt
    ? new Date(updatedAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
  return `${updatedBy?.trim() || "Unknown"} · ${when}`;
}

/** Shared UOM vocabulary for purchase / consume dropdowns. */
export const UOM_OPTIONS = [
  "ea",
  "sqft",
  "yd",
  "stick",
  "lb",
  "lbs",
  "ft",
  "in",
  "oz",
  "gal",
  "slab",
] as const;

export const ITEM_TYPE_OPTIONS = [
  { value: "raw_material", label: "raw_material" },
  { value: "sub_assembly", label: "sub_assembly" },
  { value: "finished_good", label: "finished_good" },
  { value: "service", label: "service" },
] as const;

export const FABRIC_GRADE_OPTIONS = ["A", "B", "C", "COM", "Grade A", "Grade B", "Grade C"] as const;

export const METAL_ALLOY_OPTIONS = [
  "6061-T6",
  "6063-T5",
  "Mild Steel",
] as const;

export const METAL_PROFILE_OPTIONS = ["Flat", "Angle", "Tube", "Pipe"] as const;

export const POWDER_GLOSS_OPTIONS = [
  "Flat",
  "Matte",
  "Satin",
  "Semi-Gloss",
  "Gloss",
] as const;

export const SHADE_MOTOR_OPTIONS = ["motorized", "manual"] as const;
export const SHADE_MOUNT_OPTIONS = ["wall", "base"] as const;
export const FIREPIT_FUEL_OPTIONS = ["propane", "natural_gas"] as const;
export const FIREPIT_IGNITION_OPTIONS = ["electronic", "match_lit"] as const;

type InlineCatalogDimCellProps = {
  globalSku: string;
  field: string;
  value: string;
  isNa: boolean;
  allowNa?: boolean;
  compact?: boolean;
  highlightMissing?: boolean;
  placeholder?: string;
  onSaved?: (meta: InlineSaveMeta & { naFields?: string[] }) => void;
};

/** Dimension cell with N/A checkbox — clears Missing false positives fast. */
export function InlineCatalogDimCell({
  globalSku,
  field,
  value,
  isNa,
  allowNa = true,
  compact = false,
  highlightMissing = false,
  placeholder = "—",
  onSaved,
}: InlineCatalogDimCellProps) {
  const [naChecked, setNaChecked] = useState(isNa);
  const [pendingNa, startNaTransition] = useTransition();

  useEffect(() => {
    setNaChecked(isNa);
  }, [isNa]);

  function toggleNa(next: boolean): void {
    setNaChecked(next);
    startNaTransition(async () => {
      const result = await setCatalogFieldNotApplicable(
        globalSku,
        field,
        next,
      );
      if (!result.ok) {
        setNaChecked(!next);
        return;
      }
      onSaved?.({
        value: next ? "N/A" : "",
        updatedAt: new Date().toISOString(),
        updatedBy: getOperatorName(),
        version: 1,
        naFields: result.naFields,
      });
    });
  }

  const display = naChecked ? "N/A" : value;

  return (
    <div
      className={`flex flex-col gap-0.5 ${compact ? "min-w-[2.75rem] max-w-[3.25rem]" : "min-w-[3.25rem]"}`}
    >
      {allowNa ? (
        <label
          className={`flex cursor-pointer select-none items-center gap-1 text-[9px] uppercase tracking-wide ${
            highlightMissing ? "font-semibold text-rose-400" : "text-slate-500"
          }`}
        >
          <input
            type="checkbox"
            checked={naChecked}
            disabled={pendingNa}
            onChange={(e) => toggleNa(e.target.checked)}
            className="h-3 w-3 rounded border-slate-600 bg-slate-950 accent-emerald-500"
          />
          N/A
        </label>
      ) : null}
      <InlineTextCell
        globalSku={globalSku}
        field={field}
        value={display}
        target="catalog"
        allowNa={allowNa}
        placeholder={allowNa ? placeholder : "—"}
        disabled={naChecked}
        highlightMissing={highlightMissing && !naChecked}
        onSaved={onSaved}
      />
    </div>
  );
}

type InlineImageThumbCellProps = {
  globalSku: string;
  originalName: string;
  imageUrl: string | null;
  isNa?: boolean;
  highlightMissing?: boolean;
  onSaved?: (imageUrl: string | null, naFields?: string[]) => void;
};

/** Compact thumbnail + upload; optional image N/A checkbox for health check. */
export function InlineImageThumbCell({
  globalSku,
  originalName,
  imageUrl,
  isNa = false,
  highlightMissing = false,
  onSaved,
}: InlineImageThumbCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [naChecked, setNaChecked] = useState(isNa);
  const [pendingNa, startNaTransition] = useTransition();

  useEffect(() => {
    setNaChecked(isNa);
  }, [isNa]);

  function toggleImageNa(next: boolean): void {
    setNaChecked(next);
    startNaTransition(async () => {
      const result = await setCatalogFieldNotApplicable(
        globalSku,
        "image",
        next,
      );
      if (!result.ok) {
        setNaChecked(!next);
        return;
      }
      onSaved?.(null, result.naFields);
    });
  }

  function onFile(file: File | null): void {
    if (!file || !file.type.startsWith("image/")) return;
    startUpload(async () => {
      const formData = new FormData();
      formData.set("global_sku", globalSku);
      formData.set("original_name", originalName);
      formData.set("updated_by", getOperatorName());
      formData.set("image", file);
      const result = await saveCatalogDraft(formData);
      if (result.ok) {
        onSaved?.(result.imageUrl);
      }
    });
  }

  return (
    <div className="flex w-[4.5rem] flex-col gap-1">
      <label
        className={`flex cursor-pointer select-none items-center gap-1 text-[9px] uppercase tracking-wide ${
          highlightMissing ? "font-semibold text-rose-400" : "text-slate-500"
        }`}
      >
        <input
          type="checkbox"
          checked={naChecked}
          disabled={pendingNa}
          onChange={(e) => toggleImageNa(e.target.checked)}
          className="h-3 w-3 rounded border-slate-600 bg-slate-950 accent-emerald-500"
        />
        N/A
      </label>
      <button
        type="button"
        disabled={uploading || naChecked}
        onClick={() => inputRef.current?.click()}
        className={`flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border border-dashed bg-slate-950/60 transition hover:border-emerald-500/40 ${
          highlightMissing && !naChecked && !imageUrl
            ? "border-rose-500/50"
            : "border-slate-700/80"
        } ${naChecked ? "opacity-40" : ""}`}
        title={naChecked ? "Image marked N/A" : "Upload product image"}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
        {naChecked ? (
          <span className="text-[10px] text-slate-500 line-through">N/A</span>
        ) : imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-[10px] text-slate-500">+ img</span>
        )}
      </button>
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { patchAttributeField } from "@/app/admin/dictionary/actions";
import {
  buildAllProductFieldDescriptors,
  calculateRowHealth,
} from "@/app/admin/dictionary/pim-catalog-utils";
import { getOperatorName } from "@/app/admin/dictionary/InlineCells";
import {
  SmartFieldInput,
} from "@/app/admin/shared/SmartFieldInput";
import { useToast } from "@/app/admin/shared/ToastProvider";
import { useModalA11y } from "@/app/admin/shared/useModalA11y";
import { validateRawMaterialCost, patchFieldToModalKey } from "@/server/pim/patch-validation";
import { setAttributePath } from "@/server/pim/attributes/schemas";
import { updateRawMaterial, type RawMaterialRow } from "./actions";

type Props = {
  row: RawMaterialRow | null;
  open: boolean;
  focusMissing?: boolean;
  onClose: () => void;
  onSaved: (material: RawMaterialRow) => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

export function RawMaterialDetailModal({
  row,
  open,
  focusMissing = false,
  onClose,
  onSaved,
  returnFocusRef,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [coreDraft, setCoreDraft] = useState({
    name: "",
    category: "",
    unitOfMeasure: "",
    costPerUnit: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fields = useMemo(() => {
    if (!row) return [];
    const all = buildAllProductFieldDescriptors({
      category: row.category,
      itemType: row.itemType,
      originalName: row.name,
      globalSku: row.sku,
      uomPurchase: row.unitOfMeasure,
      uomConsume: row.unitOfMeasure,
      baseCost: row.costPerUnit,
      attributes: row.attributes,
      catalog: null,
    }).filter((f) => f.section === "attribute");
    if (focusMissing) {
      return all.filter((field) => field.isMissing);
    }
    return all;
  }, [focusMissing, row]);

  useEffect(() => {
    if (!open || !row) {
      setDrafts({});
      setError(null);
      return;
    }
    setCoreDraft({
      name: row.name,
      category: row.category,
      unitOfMeasure: row.unitOfMeasure,
      costPerUnit: row.costPerUnit ?? "",
    });
    const attrFields = buildAllProductFieldDescriptors({
      category: row.category,
      itemType: row.itemType,
      originalName: row.name,
      globalSku: row.sku,
      uomPurchase: row.unitOfMeasure,
      uomConsume: row.unitOfMeasure,
      baseCost: row.costPerUnit,
      attributes: row.attributes,
      catalog: null,
    }).filter((f) => f.section === "attribute");
    const visible = focusMissing
      ? attrFields.filter((f) => f.isMissing)
      : attrFields;
    const initial: Record<string, string> = {};
    for (const field of visible) {
      initial[field.key] = field.initialValue;
    }
    setDrafts(initial);
    setFieldErrors({});
    setError(null);
  }, [open, row, focusMissing]);

  useModalA11y({
    open: open && row !== null,
    onClose,
    containerRef: panelRef,
    returnFocusRef,
  });

  const handleSave = useCallback(() => {
    if (!row) return;

    if (focusMissing) {
      for (const field of fields) {
        const raw = drafts[field.key]?.trim() ?? "";
        if (!raw) {
          setError(`Enter a value for ${field.label} or mark it N/A.`);
          return;
        }
      }
    }

    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const operator = getOperatorName();
      let version = row.version;
      let nextAttributes = { ...row.attributes };

      const costValidation = validateRawMaterialCost(coreDraft.costPerUnit);
      if (costValidation) {
        setFieldErrors({
          base_cost: costValidation.message,
        });
        setError(costValidation.message);
        toast.error(costValidation.message);
        return;
      }

      const coreChanged =
        coreDraft.name.trim() !== row.name ||
        coreDraft.category !== row.category ||
        coreDraft.unitOfMeasure !== row.unitOfMeasure ||
        coreDraft.costPerUnit.trim() !== (row.costPerUnit ?? "");

      if (coreChanged) {
        const result = await updateRawMaterial(row.sku, {
          sku: row.sku,
          name: coreDraft.name.trim(),
          category: coreDraft.category,
          unitOfMeasure: coreDraft.unitOfMeasure,
          costPerUnit: coreDraft.costPerUnit,
        });
        if (!result.ok || !result.material) {
          const message = result.ok ? "Update failed" : result.error;
          setError(message);
          toast.error(message);
          return;
        }
        version = result.material.version;
      }

      const changedAttrs = fields.filter((field) => {
        const draft = drafts[field.key]?.trim() ?? "";
        return draft !== field.initialValue.trim();
      });

      for (const field of changedAttrs) {
        const value = drafts[field.key]?.trim() ?? "";
        const result = await patchAttributeField({
          globalSku: row.sku,
          path: field.patchField,
          value,
          updatedBy: operator,
          expectedVersion: version,
        });
        if (!result.ok) {
          const key = patchFieldToModalKey(result.field ?? field.patchField);
          const message = result.message ?? result.error;
          setFieldErrors({ [key]: message });
          setError(message);
          toast.error(message);
          return;
        }
        version = result.version;
        nextAttributes = setAttributePath(
          nextAttributes,
          field.patchField,
          value || null,
        );
      }

      onSaved({
        ...row,
        name: coreDraft.name.trim(),
        category: coreDraft.category,
        unitOfMeasure: coreDraft.unitOfMeasure,
        costPerUnit: coreDraft.costPerUnit.trim() || null,
        attributes: nextAttributes,
        version,
      });
      toast.success(`Saved ${row.sku}`);
      onClose();
    });
  }, [coreDraft, drafts, fields, focusMissing, onClose, onSaved, row, toast]);

  if (!open || !row) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close raw material detail"
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="raw-material-detail-title"
        tabIndex={-1}
        className="pim-glass relative z-10 flex max-h-[min(90vh,42rem)] w-full max-w-2xl flex-col rounded-lg border border-slate-700/60 shadow-2xl shadow-black/50 outline-none"
      >
        <header className="shrink-0 border-b border-slate-800/80 px-5 py-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
            Raw material detail
          </p>
          <h2
            id="raw-material-detail-title"
            className="mt-1 font-mono text-lg text-slate-50"
          >
            {row.sku}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{row.name}</p>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                value={coreDraft.name}
                onChange={(e) =>
                  setCoreDraft((p) => ({ ...p, name: e.target.value }))
                }
                className="pim-input w-full py-2 text-sm"
                disabled={isPending}
              />
            </Field>
            <Field label="Category">
              <input
                value={coreDraft.category}
                onChange={(e) =>
                  setCoreDraft((p) => ({ ...p, category: e.target.value }))
                }
                className="pim-input w-full py-2 text-sm"
                disabled={isPending}
              />
            </Field>
            <Field label="UOM">
              <input
                value={coreDraft.unitOfMeasure}
                onChange={(e) =>
                  setCoreDraft((p) => ({
                    ...p,
                    unitOfMeasure: e.target.value.toLowerCase(),
                  }))
                }
                className="pim-input w-full py-2 font-mono text-sm"
                disabled={isPending}
              />
            </Field>
            <Field label="Cost / unit">
              <input
                type="number"
                step="0.01"
                min="0"
                value={coreDraft.costPerUnit}
                onChange={(e) => {
                  setCoreDraft((p) => ({ ...p, costPerUnit: e.target.value }));
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.base_cost;
                    return next;
                  });
                }}
                className={`pim-input w-full py-2 font-mono text-sm ${
                  fieldErrors.base_cost ? "pim-input-missing" : ""
                }`}
                disabled={isPending}
              />
              {fieldErrors.base_cost ? (
                <p className="mt-1 text-[11px] text-rose-400">
                  {fieldErrors.base_cost}
                </p>
              ) : null}
            </Field>
          </section>

          {fields.length > 0 ? (
            <section>
              <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                Category attributes
              </h3>
              <div className="space-y-3">
                {fields.map((field) => (
                  <SmartFieldInput
                    key={field.key}
                    field={field}
                    value={drafts[field.key] ?? field.initialValue}
                    disabled={isPending}
                    fieldError={fieldErrors[field.key]}
                    onChange={(next) => {
                      setDrafts((prev) => ({ ...prev, [field.key]: next }));
                      setFieldErrors((prev) => {
                        const copy = { ...prev };
                        delete copy[field.key];
                        return copy;
                      });
                    }}
                    onMarkNa={() =>
                      setDrafts((prev) => ({ ...prev, [field.key]: "N/A" }))
                    }
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-800/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          {error ? (
            <p className="text-xs text-rose-400">{error}</p>
          ) : (
            <p className="text-[11px] text-slate-500">
              Patches raw_materials_catalog and sku_mappings.
            </p>
          )}
          <div className="flex shrink-0 gap-2 self-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-md border border-slate-700/60 px-3 py-2 text-sm text-slate-400 transition hover:border-slate-600 hover:text-slate-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

export function RawMaterialHealthBadge({
  row,
  onResolve,
}: {
  row: RawMaterialRow;
  onResolve?: (trigger: HTMLElement) => void;
}) {
  const health = calculateRowHealth({
    category: row.category,
    itemType: row.itemType,
    originalName: row.name,
    globalSku: row.sku,
    attributes: row.attributes,
    catalog: null,
  });

  const EXEC_PILL =
    "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium tracking-wide";

  if (health.hasMissingData) {
    const labels = [
      ...health.missingCatalogFields,
      ...health.missingAttributeFields,
    ];
    return (
      <div className="flex flex-col items-start gap-0.5">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onResolve?.(e.currentTarget);
          }}
          className={`${EXEC_PILL} cursor-pointer border-rose-500/25 bg-rose-500/10 text-rose-300 transition hover:border-rose-400/40 hover:bg-rose-500/20`}
        >
          Missing Data
        </button>
        <span className="max-w-[8rem] text-[9px] leading-tight text-rose-400/80">
          {labels.join(", ")}
        </span>
      </div>
    );
  }

  return (
    <span
      className={`${EXEC_PILL} border-emerald-500/25 bg-emerald-500/10 text-emerald-300`}
    >
      Complete
    </span>
  );
}

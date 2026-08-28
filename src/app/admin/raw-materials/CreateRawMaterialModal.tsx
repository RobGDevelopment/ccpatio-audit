"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  buildRawMaterialCreationFields,
  isNaToken,
  type ProductFieldDescriptor,
} from "@/app/admin/dictionary/pim-catalog-utils";
import {
  SmartFieldInput,
  isSmartFieldComplete,
} from "@/app/admin/shared/SmartFieldInput";
import { validateRawMaterialCost } from "@/server/pim/patch-validation";
import { createRawMaterial, proposeRawMaterialSku, type RawMaterialRow } from "./actions";

const CATEGORY_OPTIONS = [
  "Fabric",
  "Aluminum",
  "Powder Coat",
  "Dekton",
  "Shade",
  "Metal",
  "Hardware",
  "Sub-Assembly",
  "Other",
] as const;

const UNIT_OPTIONS = ["ea", "in", "yd", "ft", "lbs", "sqft", "oz", "gal"] as const;

type Props = {
  open: boolean;
  defaultCategory?: string;
  onClose: () => void;
  onCreated: (material: RawMaterialRow) => void;
};

export function CreateRawMaterialModal({
  open,
  defaultCategory = "",
  onClose,
  onCreated,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("ea");
  const [costPerUnit, setCostPerUnit] = useState("");
  const [skuPreview, setSkuPreview] = useState("");
  const [attrDrafts, setAttrDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const attributeFields = useMemo(() => {
    if (!category) return [];
    return buildRawMaterialCreationFields(category);
  }, [category]);

  useEffect(() => {
    if (!open) return;
    setCategory(defaultCategory || "");
    setName("");
    setUnitOfMeasure("ea");
    setCostPerUnit("");
    setSkuPreview("");
    setAttrDrafts({});
    setFieldErrors({});
    setError(null);
  }, [open, defaultCategory]);

  useEffect(() => {
    if (!open || !category) {
      setAttrDrafts({});
      return;
    }
    const next: Record<string, string> = {};
    for (const field of attributeFields) {
      next[field.key] = "";
    }
    setAttrDrafts(next);
    setFieldErrors({});
  }, [attributeFields, category, open]);

  useEffect(() => {
    const trimmed = name.trim();
    if (!open || !category || !trimmed) {
      setSkuPreview("");
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void proposeRawMaterialSku({ category, name: trimmed }).then(({ sku }) => {
        if (!cancelled) setSkuPreview(sku);
      });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [category, name, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
  }, [open, category]);

  const coreFieldClass = useCallback(
    (complete: boolean, key?: string) => {
      if (key && fieldErrors[key]) return "pim-input-missing";
      if (!category) return "";
      return complete ? "pim-input-valid" : "pim-input-missing";
    },
    [category, fieldErrors],
  );

  const handleSubmit = useCallback(() => {
    if (!category) {
      setError("Select a category first.");
      return;
    }
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    const costValidation = validateRawMaterialCost(costPerUnit);
    if (costValidation) {
      setFieldErrors({ base_cost: costValidation.message });
      setError(costValidation.message);
      return;
    }

    const missingAttrs: ProductFieldDescriptor[] = [];
    for (const field of attributeFields) {
      const raw = attrDrafts[field.key]?.trim() ?? "";
      if (!isSmartFieldComplete(field, raw)) {
        missingAttrs.push(field);
      }
    }
    if (missingAttrs.length > 0) {
      setError(
        `Complete all category attributes (${missingAttrs.map((f) => f.label).join(", ")}).`,
      );
      return;
    }

    const attributes: Record<string, string> = {};
    for (const field of attributeFields) {
      attributes[field.patchField] = attrDrafts[field.key]?.trim() ?? "";
    }

    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createRawMaterial({
        sku: skuPreview,
        name: name.trim(),
        category,
        unitOfMeasure,
        costPerUnit,
        attributes,
      });
      if (!result.ok || !result.material) {
        setError(result.ok ? "Create failed" : result.error);
        return;
      }
      onCreated(result.material);
      onClose();
    });
  }, [
    attributeFields,
    attrDrafts,
    category,
    costPerUnit,
    name,
    onClose,
    onCreated,
    skuPreview,
    unitOfMeasure,
  ]);

  if (!open) return null;

  const nameComplete = name.trim().length > 0;
  const uomComplete = unitOfMeasure.trim().length > 0;
  const costComplete =
    !costPerUnit.trim() ||
    isNaToken(costPerUnit) ||
    validateRawMaterialCost(costPerUnit) === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        aria-label="Close create raw material"
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-rm-title"
        tabIndex={-1}
        className="pim-glass relative z-10 flex max-h-[min(92vh,44rem)] w-full max-w-2xl flex-col rounded-lg border border-slate-700/60 shadow-2xl shadow-black/50 outline-none"
      >
        <header className="shrink-0 border-b border-slate-800/80 px-5 py-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
            New raw material
          </p>
          <h2 id="create-rm-title" className="mt-1 text-lg text-slate-50">
            Add Raw Material
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Select a category first — required attributes appear automatically.
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section>
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Category <span className="text-rose-400/80">*</span>
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={isPending}
                className={`pim-input w-full appearance-none py-2 text-sm ${
                  category ? "pim-input-valid" : "pim-input-missing"
                }`}
              >
                <option value="" className="bg-slate-950">
                  Select category…
                </option>
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt} className="bg-slate-950">
                    {opt}
                  </option>
                ))}
              </select>
            </label>
          </section>

          {category ? (
            <>
              <section className="grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Name <span className="text-rose-400/80">*</span>
                  </span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isPending}
                    placeholder="Factory / vendor name"
                    className={`pim-input w-full py-2 text-sm ${coreFieldClass(nameComplete)}`}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    SKU (auto)
                  </span>
                  <input
                    value={skuPreview}
                    readOnly
                    disabled
                    className="pim-input w-full py-2 font-mono text-xs uppercase text-slate-400"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    UOM <span className="text-rose-400/80">*</span>
                  </span>
                  <select
                    value={unitOfMeasure}
                    onChange={(e) => setUnitOfMeasure(e.target.value)}
                    disabled={isPending}
                    className={`pim-input w-full appearance-none py-2 font-mono text-sm ${coreFieldClass(uomComplete)}`}
                  >
                    {UNIT_OPTIONS.map((unit) => (
                      <option key={unit} value={unit} className="bg-slate-950">
                        {unit}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                    Cost / unit
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costPerUnit}
                    onChange={(e) => {
                      setCostPerUnit(e.target.value);
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.base_cost;
                        return next;
                      });
                    }}
                    disabled={isPending}
                    placeholder="0.00"
                    className={`pim-input w-full py-2 font-mono text-sm ${coreFieldClass(costComplete, "base_cost")}`}
                  />
                  {fieldErrors.base_cost ? (
                    <p className="mt-1 text-[11px] text-rose-400">
                      {fieldErrors.base_cost}
                    </p>
                  ) : null}
                </label>
              </section>

              {attributeFields.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
                    Category attributes
                  </h3>
                  <div className="space-y-3">
                    {attributeFields.map((field) => (
                      <SmartFieldInput
                        key={field.key}
                        field={field}
                        value={attrDrafts[field.key] ?? ""}
                        disabled={isPending}
                        fieldError={fieldErrors[field.key]}
                        showValidationState
                        onChange={(next) => {
                          setAttrDrafts((prev) => ({ ...prev, [field.key]: next }));
                          setFieldErrors((prev) => {
                            const copy = { ...prev };
                            delete copy[field.key];
                            return copy;
                          });
                        }}
                        onMarkNa={() =>
                          setAttrDrafts((prev) => ({ ...prev, [field.key]: "N/A" }))
                        }
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-800/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          {error ? (
            <p className="text-xs text-rose-400">{error}</p>
          ) : (
            <p className="text-[11px] text-slate-500">
              All required fields must be valid before create.
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
              onClick={handleSubmit}
              disabled={isPending || !category}
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {isPending ? "Creating…" : "Create Raw Material"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

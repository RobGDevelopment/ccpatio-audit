"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { isNaToken } from "@/app/admin/dictionary/pim-catalog-utils";
import { useToast } from "@/app/admin/shared/ToastProvider";
import { useModalA11y } from "@/app/admin/shared/useModalA11y";
import { validateRawMaterialCost } from "@/server/pim/patch-validation";
import type { ItemType } from "@/server/db/schema";
import {
  createSkuMapping,
  proposeSku,
  type SkuMappingInput,
} from "./actions";
import type { SkuMappingRow } from "./types";

const CATEGORY_OPTIONS = [
  "Finished Good",
  "Furniture",
  "Fabric",
  "Metal",
  "Powder",
  "Powder Coat",
  "Aluminum",
  "Dekton",
  "Shade",
  "Firepit",
  "Hardware",
  "Sub-Assembly",
  "Other",
] as const;

const ITEM_TYPE_OPTIONS: Array<{ value: ItemType; label: string }> = [
  { value: "finished_good", label: "Finished good" },
  { value: "raw_material", label: "Raw material" },
  { value: "sub_assembly", label: "Sub-assembly" },
  { value: "service", label: "Service" },
];

const UNIT_OPTIONS = ["ea", "in", "yd", "ft", "lbs", "sqft", "oz", "gal"] as const;

type Props = {
  open: boolean;
  defaultCategory?: string;
  onClose: () => void;
  onCreated: (row: SkuMappingRow) => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

export function CreateSkuModal({
  open,
  defaultCategory = "",
  onClose,
  onCreated,
  returnFocusRef,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [category, setCategory] = useState("");
  const [itemType, setItemType] = useState<ItemType>("finished_good");
  const [name, setName] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("ea");
  const [baseCost, setBaseCost] = useState("");
  const [syncToWoo, setSyncToWoo] = useState(false);
  const [skuPreview, setSkuPreview] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setCategory(defaultCategory || "");
    setItemType("finished_good");
    setName("");
    setUnitOfMeasure("ea");
    setBaseCost("");
    setSyncToWoo(false);
    setSkuPreview("");
    setFieldErrors({});
    setError(null);
  }, [open, defaultCategory]);

  useEffect(() => {
    const trimmed = name.trim();
    if (!open || !category || !trimmed) {
      setSkuPreview("");
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void proposeSku({ category, name: trimmed, itemType }).then(({ sku }) => {
        if (!cancelled) setSkuPreview(sku);
      });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [category, itemType, name, open]);

  useModalA11y({ open, onClose, containerRef: panelRef, returnFocusRef });

  const handleSubmit = useCallback(() => {
    if (!category) {
      setError("Select a category first.");
      return;
    }
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    const costValidation = validateRawMaterialCost(baseCost);
    if (costValidation) {
      setFieldErrors({ base_cost: costValidation.message });
      setError(costValidation.message);
      return;
    }

    const payload: SkuMappingInput = {
      sku: skuPreview,
      name: name.trim(),
      category,
      itemType,
      unitOfMeasure,
      baseCost,
      syncToWoo,
    };

    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await createSkuMapping(payload);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`Created ${result.row.globalSku}`);
      onCreated(result.row);
      onClose();
    });
  }, [
    baseCost,
    category,
    itemType,
    name,
    onClose,
    onCreated,
    skuPreview,
    syncToWoo,
    toast,
    unitOfMeasure,
  ]);

  if (!open) return null;

  const nameComplete = name.trim().length > 0;
  const costComplete =
    !baseCost.trim() ||
    isNaToken(baseCost) ||
    validateRawMaterialCost(baseCost) === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <button
        type="button"
        aria-label="Close create SKU"
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-sku-title"
        tabIndex={-1}
        className="pim-glass relative z-10 flex max-h-[min(92vh,44rem)] w-full max-w-2xl flex-col rounded-lg border border-slate-700/60 shadow-2xl shadow-black/50 outline-none"
      >
        <header className="shrink-0 border-b border-slate-800/80 px-5 py-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
            New global SKU
          </p>
          <h2 id="create-sku-title" className="mt-1 text-lg text-slate-50">
            Add SKU
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Creates a row in the global SKU dictionary. Finished goods and raw
            materials also provision their catalog tables.
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="grid gap-3 sm:grid-cols-2">
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
            <label className="block">
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-500">
                Item type <span className="text-rose-400/80">*</span>
              </span>
              <select
                value={itemType}
                onChange={(e) => setItemType(e.target.value as ItemType)}
                disabled={isPending}
                className="pim-input pim-input-valid w-full appearance-none py-2 text-sm"
              >
                {ITEM_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-slate-950">
                    {opt.label}
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
                    placeholder="Factory / product name"
                    className={`pim-input w-full py-2 text-sm ${
                      nameComplete ? "pim-input-valid" : "pim-input-missing"
                    }`}
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
                    UOM
                  </span>
                  <select
                    value={unitOfMeasure}
                    onChange={(e) => setUnitOfMeasure(e.target.value)}
                    disabled={isPending}
                    className="pim-input pim-input-valid w-full appearance-none py-2 font-mono text-sm"
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
                    value={baseCost}
                    onChange={(e) => {
                      setBaseCost(e.target.value);
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.base_cost;
                        return next;
                      });
                    }}
                    disabled={isPending}
                    placeholder="Optional"
                    className={`pim-input w-full py-2 text-sm ${
                      fieldErrors.base_cost
                        ? "pim-input-missing"
                        : costComplete
                          ? "pim-input-valid"
                          : ""
                    }`}
                  />
                </label>
                <label className="flex items-center gap-2 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={syncToWoo}
                    onChange={(e) => setSyncToWoo(e.target.checked)}
                    disabled={isPending}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-emerald-500/40"
                  />
                  <span className="text-sm text-slate-300">
                    Flag for WooCommerce export
                  </span>
                </label>
              </section>
            </>
          ) : null}

          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-800/80 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-slate-700/60 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !category || !nameComplete}
            className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create SKU"}
          </button>
        </footer>
      </div>
    </div>
  );
}

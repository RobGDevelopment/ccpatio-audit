"use client";

import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  patchAttributeField,
  patchCatalogField,
  patchMappingField,
} from "./actions";
import { getOperatorName } from "./InlineCells";
import {
  buildAllProductFieldDescriptors,
  isNaToken,
  type ProductFieldDescriptor,
} from "./pim-catalog-utils";
import { SmartFieldInput } from "@/app/admin/shared/SmartFieldInput";
import { patchFieldToModalKey } from "@/server/pim/patch-validation";
import { setAttributePath } from "@/server/pim/attributes/schemas";
import type { CatalogFields, SkuMappingRow } from "./types";

const CATALOG_PATCH_TO_KEY: Record<string, keyof CatalogFields> = {
  length: "length",
  depth: "depth",
  height: "height",
  arm_height: "armHeight",
  sit_height: "sitHeight",
  weight: "weight",
  msrp: "msrp",
};

type Props = {
  row: SkuMappingRow | null;
  open: boolean;
  focusMissing?: boolean;
  onClose: () => void;
  onPatchSaved: (sku: string, patch: Partial<SkuMappingRow>) => void;
};

export function ProductDetailModal({
  row,
  open,
  focusMissing = false,
  onClose,
  onPatchSaved,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fields = useMemo(() => {
    if (!row) return [];
    const all = buildAllProductFieldDescriptors({
      category: row.category,
      itemType: row.itemType,
      originalName: row.originalName,
      globalSku: row.globalSku,
      uomPurchase: row.uomPurchase,
      uomConsume: row.uomConsume,
      baseCost: row.baseCost,
      attributes: row.attributes,
      catalog: row.catalog,
    });
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
    const initial: Record<string, string> = {};
    for (const field of buildAllProductFieldDescriptors({
      category: row.category,
      itemType: row.itemType,
      originalName: row.originalName,
      globalSku: row.globalSku,
      uomPurchase: row.uomPurchase,
      uomConsume: row.uomConsume,
      baseCost: row.baseCost,
      attributes: row.attributes,
      catalog: row.catalog,
    }).filter((f) => !focusMissing || f.isMissing)) {
      initial[field.key] = field.initialValue;
    }
    setDrafts(initial);
    setFieldErrors({});
    setError(null);
  }, [open, row, focusMissing]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const markNa = useCallback((key: string) => {
    setDrafts((prev) => ({ ...prev, [key]: "N/A" }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  function applyPatchError(
    result: { field?: string; message?: string; error: string },
    visibleFields: ProductFieldDescriptor[],
  ): void {
    if (result.field) {
      const key =
        visibleFields.find(
          (f) => f.patchField === result.field || f.key === result.field,
        )?.key ?? patchFieldToModalKey(result.field);
      setFieldErrors({ [key]: result.message ?? result.error });
    }
    setError(result.message ?? result.error);
  }

  const handleSave = useCallback(() => {
    if (!row || fields.length === 0) return;

    const changed = fields.filter((field) => {
      const draft = drafts[field.key]?.trim() ?? "";
      const initial = field.initialValue.trim();
      return draft !== initial;
    });

    if (focusMissing) {
      for (const field of fields) {
        const raw = drafts[field.key]?.trim() ?? "";
        if (!raw) {
          setError(`Enter a value for ${field.label} or mark it N/A.`);
          return;
        }
      }
    }

    if (changed.length === 0) {
      onClose();
      return;
    }

    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const operator = getOperatorName();
      let version = row.version;
      let nextAttributes = { ...row.attributes };
      let nextCatalog: CatalogFields | null = row.catalog
        ? { ...row.catalog, naFields: [...row.catalog.naFields] }
        : {
            msrp: null,
            cost: null,
            length: null,
            depth: null,
            height: null,
            armHeight: null,
            sitHeight: null,
            weight: null,
            description: null,
            imageUrl: null,
            qboItemCode: null,
            naFields: [],
          };
      const mappingPatch: Partial<SkuMappingRow> = {};
      let mappingUpdatedAt = row.mappingUpdatedAt ?? new Date().toISOString();
      let mappingUpdatedBy: string | null = row.mappingUpdatedBy ?? operator;

      for (const field of changed) {
        const value = drafts[field.key]?.trim() ?? "";

        if (field.target === "mapping") {
          const result = await patchMappingField({
            globalSku: row.globalSku,
            field: field.patchField,
            value,
            updatedBy: operator,
            expectedVersion: version,
          });
          if (!result.ok) {
            applyPatchError(result, fields);
            return;
          }
          version = result.version;
          mappingUpdatedAt = result.updatedAt;
          mappingUpdatedBy = result.updatedBy ?? operator;
          if (field.patchField === "original_name") {
            mappingPatch.originalName = value;
          } else if (field.patchField === "uom_purchase") {
            mappingPatch.uomPurchase = value || null;
          } else if (field.patchField === "uom_consume") {
            mappingPatch.uomConsume = value || null;
          } else if (field.patchField === "base_cost") {
            mappingPatch.baseCost = value || null;
          }
        } else if (field.target === "catalog") {
          const result = await patchCatalogField({
            globalSku: row.globalSku,
            field: field.patchField,
            value,
            updatedBy: operator,
          });
          if (!result.ok) {
            applyPatchError(result, fields);
            return;
          }
          version = result.version;
          mappingUpdatedAt = result.updatedAt;
          mappingUpdatedBy = result.updatedBy ?? operator;
          const catalogKey = CATALOG_PATCH_TO_KEY[field.patchField];
          if (catalogKey) {
            const markAsNa = field.allowNa && isNaToken(value);
            nextCatalog = {
              ...nextCatalog!,
              [catalogKey]: markAsNa || !value ? null : value,
              naFields: result.naFields ?? nextCatalog!.naFields,
              updatedAt: result.updatedAt,
              updatedBy: result.updatedBy,
            };
          }
        } else {
          const result = await patchAttributeField({
            globalSku: row.globalSku,
            path: field.patchField,
            value,
            updatedBy: operator,
            expectedVersion: version,
          });
          if (!result.ok) {
            applyPatchError(result, fields);
            return;
          }
          version = result.version;
          mappingUpdatedAt = result.updatedAt;
          mappingUpdatedBy = result.updatedBy ?? operator;
          nextAttributes = setAttributePath(
            nextAttributes,
            field.patchField,
            value || null,
          );
        }
      }

      onPatchSaved(row.globalSku, {
        ...mappingPatch,
        attributes: nextAttributes,
        catalog: nextCatalog,
        version,
        mappingUpdatedAt,
        mappingUpdatedBy,
      });
      onClose();
    });
  }, [drafts, fields, focusMissing, onClose, onPatchSaved, row]);

  if (!open || !row) return null;

  const coreFields = fields.filter((f) => f.section === "core");
  const catalogFields = fields.filter((f) => f.section === "catalog");
  const attributeFields = fields.filter((f) => f.section === "attribute");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close product detail modal"
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-detail-title"
        className="pim-glass relative z-10 flex max-h-[min(90vh,42rem)] w-full max-w-2xl flex-col rounded-lg border border-slate-700/60 shadow-2xl shadow-black/50"
      >
        <header className="shrink-0 border-b border-slate-800/80 px-5 py-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
            {focusMissing ? "Rapid resolution" : "Product detail"}
          </p>
          <h2
            id="product-detail-title"
            className="mt-1 font-mono text-lg text-slate-50"
          >
            {row.globalSku}
          </h2>
          <p className="mt-1 text-sm text-slate-400">{row.originalName}</p>
          <p className="mt-2 text-[11px] text-slate-500">
            {row.category} · {row.itemType.replace(/_/g, " ")}
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {fields.length === 0 ? (
            <p className="text-sm text-emerald-300">
              All required fields are complete.
            </p>
          ) : (
            <>
              {coreFields.length > 0 ? (
                <FieldSection title="Core fields">
                  {coreFields.map((field) => (
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
                      onMarkNa={() => markNa(field.key)}
                    />
                  ))}
                </FieldSection>
              ) : null}
              {catalogFields.length > 0 ? (
                <FieldSection title="Catalog dimensions">
                  {catalogFields.map((field) => (
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
                      onMarkNa={() => markNa(field.key)}
                    />
                  ))}
                </FieldSection>
              ) : null}
              {attributeFields.length > 0 ? (
                <FieldSection title="Category attributes">
                  {attributeFields.map((field) => (
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
                      onMarkNa={() => markNa(field.key)}
                    />
                  ))}
                </FieldSection>
              ) : null}
            </>
          )}
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-800/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          {error ? (
            <p className="text-xs text-rose-400">{error}</p>
          ) : (
            <p className="text-[11px] text-slate-500">
              Saves patch sku_mappings, finished_goods_catalog, and attributes.
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
              disabled={isPending || fields.length === 0}
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

function FieldSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-500">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

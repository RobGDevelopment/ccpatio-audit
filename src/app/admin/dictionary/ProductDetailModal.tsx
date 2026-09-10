"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { DeveloperFeedbackForm } from "@/app/admin/shared/DeveloperFeedbackForm";
import { DiscontinueButton } from "@/app/admin/shared/DiscontinueButton";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import { useToast } from "@/app/admin/shared/ToastProvider";
import { useModalA11y } from "@/app/admin/shared/useModalA11y";
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
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

export function ProductDetailModal({
  row,
  open,
  focusMissing = false,
  onClose,
  onPatchSaved,
  returnFocusRef,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
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
      setIsEditing(false);
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
    // Rapid-resolution opens straight into edit mode.
    setIsEditing(Boolean(focusMissing));
  }, [open, row, focusMissing]);

  useModalA11y({
    open: open && row !== null,
    onClose,
    containerRef: panelRef,
    returnFocusRef,
  });

  const dirty = useMemo(() => {
    return fields.some((field) => {
      const draft = drafts[field.key]?.trim() ?? "";
      return draft !== field.initialValue.trim();
    });
  }, [drafts, fields]);

  const markNa = useCallback((key: string) => {
    setDrafts((prev) => ({ ...prev, [key]: "N/A" }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const applyPatchError = useCallback(
    (
      result: { field?: string; message?: string; error: string },
      visibleFields: ProductFieldDescriptor[],
    ): void => {
      if (result.field) {
        const key =
          visibleFields.find(
            (f) => f.patchField === result.field || f.key === result.field,
          )?.key ?? patchFieldToModalKey(result.field);
        setFieldErrors({ [key]: result.message ?? result.error });
      }
      const message = result.message ?? result.error;
      setError(message);
      toast.error(message);
    },
    [toast],
  );

  const handleSave = useCallback(() => {
    if (!row || fields.length === 0) return;

    const changed = fields.filter((field) => {
      const draft = drafts[field.key]?.trim() ?? "";
      const initial = field.initialValue.trim();
      return draft !== initial;
    });

    if (changed.length === 0) {
      setIsEditing(false);
      return;
    }

    const originalDrafts = { ...drafts };
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      try {
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
              setDrafts(originalDrafts);
              applyPatchError(result, fields);
              if (
                result.error?.includes("Failed to find Server Action") ||
                result.error?.includes("digest")
              ) {
                toast.error(
                  "System updated. Please refresh your page to continue saving.",
                );
              } else {
                toast.error(
                  `Failed to save: ${result.error || "Database error"}. Please try again.`,
                );
              }
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
              setDrafts(originalDrafts);
              applyPatchError(result, fields);
              if (
                result.error?.includes("Failed to find Server Action") ||
                result.error?.includes("digest")
              ) {
                toast.error(
                  "System updated. Please refresh your page to continue saving.",
                );
              } else {
                toast.error(
                  `Failed to save: ${result.error || "Database error"}. Please try again.`,
                );
              }
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
              setDrafts(originalDrafts);
              applyPatchError(result, fields);
              if (
                result.error?.includes("Failed to find Server Action") ||
                result.error?.includes("digest")
              ) {
                toast.error(
                  "System updated. Please refresh your page to continue saving.",
                );
              } else {
                toast.error(
                  `Failed to save: ${result.error || "Database error"}. Please try again.`,
                );
              }
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
        toast.success(`Saved ${row.globalSku}`);
        setIsEditing(false);
        onClose();
      } catch (err: unknown) {
        setDrafts(originalDrafts);
        const msg =
          err instanceof Error ? err.message : "An unexpected error occurred.";
        if (msg.includes("Failed to find Server Action") || msg.includes("digest")) {
          toast.error(
            "System updated. Please refresh your page to continue saving.",
          );
        }
        setError(msg);
        toast.error(`Failed to save: ${msg}. Please try again.`);
      }
    });
  }, [drafts, fields, onClose, onPatchSaved, row, toast, applyPatchError]);

  if (!open || !row) return null;

  const coreFields = fields.filter((f) => f.section === "core");
  const catalogFields = fields.filter((f) => f.section === "catalog");
  const attributeFields = fields.filter((f) => f.section === "attribute");
  const factoryBomHref = `/admin/factory-bom?sku=${encodeURIComponent(row.globalSku)}`;

  function renderFieldGrid(
    sectionFields: ProductFieldDescriptor[],
    title: string,
  ): ReactNode {
    if (sectionFields.length === 0) return null;

    if (!isEditing) {
      return (
        <FieldSection title={title}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sectionFields.map((field) => {
              const value = drafts[field.key] ?? field.initialValue;
              const display = value.trim() ? value : "—";
              return (
                <div
                  key={field.key}
                  className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-3 py-2.5"
                >
                  <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    {field.label}
                  </p>
                  <p
                    className={`mt-1 text-sm ${
                      display === "—" ? "text-zinc-600" : "font-mono text-zinc-100"
                    }`}
                  >
                    {display}
                  </p>
                </div>
              );
            })}
          </div>
        </FieldSection>
      );
    }

    return (
      <FieldSection title={title}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sectionFields.map((field) => (
            <SmartFieldInput
              key={field.key}
              field={field}
              value={drafts[field.key] ?? field.initialValue}
              disabled={isPending}
              showValidationState
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
        </div>
      </FieldSection>
    );
  }

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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-detail-title"
        tabIndex={-1}
        className="pim-glass relative z-10 flex max-h-[min(92vh,56rem)] w-full max-w-4xl flex-col rounded-lg border border-zinc-800 shadow-2xl shadow-black/50 outline-none"
      >
        <header className="shrink-0 border-b border-zinc-800 px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                {focusMissing ? "Rapid resolution" : "Product detail"}
              </p>
              <h2
                id="product-detail-title"
                className="mt-1 font-mono text-lg text-zinc-50"
              >
                {row.globalSku}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">{row.originalName}</p>
              <p className="mt-2 text-[11px] text-zinc-500">
                {row.category} · {row.itemType.replace(/_/g, " ")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsEditing((prev) => !prev)}
                disabled={isPending}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
                  isEditing
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                }`}
              >
                {isEditing ? "View mode" : "Edit mode"}
              </button>
              <Link
                href={factoryBomHref}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
              >
                <FactoryIcon />
                Manage BOM / Build Recipe
              </Link>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {fields.length === 0 ? (
            <p className="text-sm text-emerald-300">
              All required fields are complete.
            </p>
          ) : (
            <>
              {renderFieldGrid(coreFields, "Core fields")}
              {renderFieldGrid(catalogFields, "Catalog dimensions")}
              {renderFieldGrid(attributeFields, "Category attributes")}
            </>
          )}
        </div>

        <footer className="flex shrink-0 flex-col gap-4 border-t border-zinc-800 px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex w-full max-w-sm flex-col items-start gap-3">
            {error ? (
              <p className="text-xs text-rose-400">{error}</p>
            ) : (
              <p className="text-[11px] text-zinc-500">
                {isEditing
                  ? "Saves patch sku_mappings, finished_goods_catalog, and attributes."
                  : "Switch to Edit mode to change catalog fields."}
              </p>
            )}
            <div className="w-full">
              <DeveloperFeedbackForm
                globalSku={row.globalSku}
                panelLocation="Product Detail Modal"
              />
            </div>
          </div>
          <div className="flex shrink-0 gap-2 self-end">
            <DiscontinueButton globalSku={row.globalSku} />
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50"
            >
              Cancel
            </button>
            {isEditing ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending || fields.length === 0}
                className={`rounded-md px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${
                  dirty
                    ? "bg-emerald-600 hover:bg-emerald-500"
                    : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                }`}
              >
                {isPending ? "Saving…" : "Save"}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

function FactoryIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 21h18" />
      <path d="M5 21V10l5 3V10l5 3V7l6 4v10" />
      <path d="M9 21v-4h4v4" />
    </svg>
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
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

"use client";

import Link from "next/link";

import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { resolveAttributeTabKey } from "@/lib/raw-material-sku";
import { setAttributePath } from "@/server/pim/attributes/schemas";
import { CATEGORY_REQUIRED_ATTRIBUTES } from "@/server/pim/attributes/health";
import {
  EditableSelectCell,
  FABRIC_GRADE_OPTIONS,
  FIREPIT_FUEL_OPTIONS,
  FIREPIT_IGNITION_OPTIONS,
  getOperatorName,
  InlineCatalogDimCell,
  InlineImageThumbCell,
  InlineTextCell,
  METAL_ALLOY_OPTIONS,
  METAL_PROFILE_OPTIONS,
  SHADE_MOUNT_OPTIONS,
  SHADE_MOTOR_OPTIONS,
} from "./InlineCells";
import {
  calculateRowHealth,
  catalogFieldToken,
  getMissingAttributeFields,
  inferSuggestedNaFields,
  getMissingCatalogFields,
  resolveAttributeValue,
} from "./pim-catalog-utils";
import type { DictionaryTableMeta, SkuMappingRow } from "./types";

const col = createColumnHelper<SkuMappingRow>();

const EXEC_PILL =
  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium tracking-wide";

function normalizeTab(tab: string): string {
  return tab.trim().toLowerCase();
}

function showBomForRow(row: SkuMappingRow): boolean {
  return (
    row.itemType === "finished_good" || row.itemType === "sub_assembly"
  );
}

export function showExpandForRow(
  row: SkuMappingRow,
  activeTab: string,
): boolean {
  const tab = normalizeTab(activeTab);
  if (tab === "finished good" || tab === "furniture") {
    return (
      Boolean(row.catalog) ||
      row.itemType === "finished_good" ||
      row.itemType === "sub_assembly"
    );
  }
  return showBomForRow(row);
}

/** Finished-good catalog completeness (blank + na_fields = pass). */
export function isFinishedGoodCatalogComplete(row: SkuMappingRow): boolean {
  return getMissingCatalogFields({
    category: row.category,
    itemType: row.itemType,
    originalName: row.originalName,
    globalSku: row.globalSku,
    catalog: row.catalog,
  }).length === 0;
}

function rowHealth(row: SkuMappingRow) {
  return calculateRowHealth({
    category: row.category,
    itemType: row.itemType,
    originalName: row.originalName,
    globalSku: row.globalSku,
    attributes: row.attributes,
    catalog: row.catalog,
  });
}

function rowMissingCatalogTokens(row: SkuMappingRow): Set<string> {
  return new Set(
    rowHealth(row).missingCatalogFields.map((key) => catalogFieldToken(key)),
  );
}

type AttrCol = {
  key: string;
  paths: string[];
  writePath: string;
  header: string;
  minWidth?: string;
  selectOptions?: ReadonlyArray<string | { value: string; label: string }>;
};

const ATTR_COLUMN_META: Record<
  string,
  Omit<AttrCol, "key" | "paths" | "writePath">[]
> = {
  dekton: [
    { header: "Slab L" },
    { header: "Slab W" },
    { header: "Thick mm" },
    {
      header: "Finish",
      selectOptions: ["Matte", "Polished", "Textured", "Satin", "N/A"],
    },
    { header: "Yield sqft" },
  ],
  fabric: [
    {
      header: "Grade",
      selectOptions: [...FABRIC_GRADE_OPTIONS, "N/A"],
    },
    { header: "Roll W" },
    { header: "Pattern repeat" },
    { header: "Rub count" },
    { header: "Colorway" },
  ],
  metal: [
    {
      header: "Profile",
      selectOptions: [...METAL_PROFILE_OPTIONS, "N/A"],
    },
    { header: "Dimensions" },
    { header: "Wall thick" },
    {
      header: "Alloy",
      selectOptions: [...METAL_ALLOY_OPTIONS, "N/A"],
    },
    { header: "Stock L" },
  ],
  powder: [
    { header: "Finish type" },
    { header: "Cure °F" },
    { header: "Cure min" },
    { header: "RAL" },
  ],
  shade: [
    { header: "Span W" },
    { header: "Span L" },
    { header: "Wind" },
    {
      header: "Mount",
      selectOptions: [...SHADE_MOUNT_OPTIONS, "N/A"],
    },
    {
      header: "Motor",
      selectOptions: [...SHADE_MOTOR_OPTIONS, "N/A"],
    },
  ],
  firepit: [
    { header: "BTU" },
    {
      header: "Fuel",
      selectOptions: [...FIREPIT_FUEL_OPTIONS, "N/A"],
    },
    { header: "Burner" },
    {
      header: "Ignition",
      selectOptions: [...FIREPIT_IGNITION_OPTIONS, "N/A"],
    },
  ],
};

function buildAttrCols(tabKey: string): AttrCol[] {
  const resolved = resolveAttributeTabKey(tabKey);
  const reqs = CATEGORY_REQUIRED_ATTRIBUTES[resolved];
  const meta = ATTR_COLUMN_META[resolved];
  if (!reqs || !meta) return [];
  return reqs.map((req, index) => ({
    key: req.key,
    paths: req.paths,
    writePath: req.paths[0]!,
    header: meta[index]?.header ?? req.key,
    selectOptions: meta[index]?.selectOptions,
  }));
}

function rowMissingAttributeKeys(row: SkuMappingRow): Set<string> {
  return new Set(
    getMissingAttributeFields({
      category: row.category,
      attributes: row.attributes,
    }),
  );
}

function DataHealthPunchlist({
  row,
  onResolve,
}: {
  row: SkuMappingRow;
  onResolve?: (trigger: HTMLElement) => void;
}) {
  const health = rowHealth(row);

  if (health.hasMissingData) {
    const labels = [
      ...health.missingCatalogFields,
      ...health.missingAttributeFields,
    ];
    return (
      <div className="flex flex-col gap-0.5 items-start">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onResolve?.(event.currentTarget);
          }}
          title="Quick-fix missing fields"
          className={`${EXEC_PILL} border-rose-500/25 bg-rose-500/10 text-rose-300 transition hover:border-rose-400/40 hover:bg-rose-500/20 hover:text-rose-200 cursor-pointer`}
        >
          Missing Data
        </button>
        <span className="text-[9px] text-rose-400/80 leading-tight">
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

function leanCoreColumns(
  meta: DictionaryTableMeta,
): ColumnDef<SkuMappingRow, unknown>[] {
  return [
    col.accessor("originalName", {
      header: "Name",
      cell: ({ row }) => (
        <span
          className="block max-w-48 truncate text-[15px] font-semibold text-zinc-50"
          title={row.original.originalName}
        >
          {row.original.originalName || "—"}
        </span>
      ),
    }),
    col.accessor("globalSku", {
      header: "SKU",
      cell: ({ row }) => (
        <span
          className="whitespace-nowrap font-mono text-[11px] text-zinc-500"
          title={row.original.globalSku}
        >
          {row.original.globalSku}
        </span>
      ),
    }),
    col.accessor("category", {
      header: "Category",
      cell: ({ row }) => (
        <span className="text-sm text-zinc-400">{row.original.category}</span>
      ),
    }),
    col.display({
      id: "uom",
      header: "UOM",
      cell: ({ row }) => (
        <span className="font-mono text-xs text-zinc-400">
          {row.original.uomConsume ?? row.original.uomPurchase ?? "—"}
        </span>
      ),
    }),
    col.display({
      id: "price",
      header: "Cost / MSRP",
      cell: ({ row }) => {
        const fg =
          row.original.itemType === "finished_good" ||
          row.original.category.trim().toLowerCase() === "finished good";
        const value = fg
          ? row.original.catalog?.msrp
          : (row.original.baseCost ?? row.original.catalog?.cost);
        return (
          <span className="font-mono text-xs text-zinc-400">
            {value?.trim() ? value : "—"}
          </span>
        );
      },
    }),
    ...(meta ? [] : []),
  ] as ColumnDef<SkuMappingRow, unknown>[];
}

function ecommColumn(): ColumnDef<SkuMappingRow, unknown> {
  return col.display({
    id: "sync_to_woo",
    header: "Web",
    cell: ({ row, table }) => {
      const m = table.options.meta as DictionaryTableMeta;
      return (
        <div
          className="flex justify-center"
          onClick={(event) => event.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={row.original.syncToWoo}
            onChange={(event) =>
              m.onToggleSyncToWoo(row.original.globalSku, event.target.checked)
            }
            aria-label={`WooCommerce export for ${row.original.globalSku}`}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 text-emerald-500 focus:ring-emerald-500/40"
          />
        </div>
      );
    },
  });
}

function healthColumn(): ColumnDef<SkuMappingRow, unknown> {
  return col.display({
    id: "data_health",
    header: "Data health",
    cell: ({ row, table }) => {
      const m = table.options.meta as DictionaryTableMeta;
      return (
        <DataHealthPunchlist
          row={row.original}
          onResolve={(trigger) =>
            m.onOpenProductDetail(row.original, { focusMissing: true }, trigger)
          }
        />
      );
    },
  });
}

function actionsColumn(): ColumnDef<SkuMappingRow, unknown> {
  return col.display({
    id: "actions",
    header: "Actions",
    cell: ({ row, table }) => {
      const m = table.options.meta as DictionaryTableMeta;
      const canExpand = showExpandForRow(row.original, m.columnTab);
      return (
        <div
          className="flex items-center gap-1"
          onClick={(event) => event.stopPropagation()}
        >
          {canExpand ? (
            normalizeTab(m.columnTab) === "finished good" || normalizeTab(m.columnTab) === "furniture" ? (
              <button
                type="button"
                aria-label="Toggle details"
                onClick={(e) => {
                  e.stopPropagation();
                  m.onToggleExpand(row.original.globalSku);
                }}
                className="inline-flex h-7 items-center justify-center rounded-md bg-emerald-600 px-3 text-[11px] font-medium tracking-wide text-zinc-50 transition hover:bg-emerald-500 shadow-sm"
              >
                Details
              </button>
            ) : (
              <Link
                href={`/admin/dictionary/bom/${encodeURIComponent(row.original.globalSku)}`}
                className="inline-flex h-7 items-center justify-center rounded-md bg-emerald-600 px-3 text-[11px] font-medium tracking-wide text-zinc-50 transition hover:bg-emerald-500 shadow-sm"
              >
                Build Recipe
              </Link>
            )
          ) : null}
          <button
            type="button"
            aria-label={`Inspect ${row.original.globalSku}`}
            title="Inspect / edit"
            onClick={(e) => {
              e.stopPropagation();
              m.onOpenProductDetail(row.original, undefined, e.currentTarget);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700/60 text-zinc-400 transition hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-300"
          >
            <InspectIcon />
          </button>
          <button
            type="button"
            aria-label={`Delete ${row.original.globalSku}`}
            title="Delete SKU"
            onClick={(e) => {
              e.stopPropagation();
              m.onDelete(row.original.globalSku);
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-400"
          >
            <TrashIcon />
          </button>
        </div>
      );
    },
  });
}

function seatingCatalogColumns(
  compact = false,
): ColumnDef<SkuMappingRow, unknown>[] {
  const imageCol = col.display({
    id: "catalog_image",
    header: "Img",
    cell: ({ row, table }) => {
      const m = table.options.meta as DictionaryTableMeta;
      const na = row.original.catalog?.naFields ?? [];
      return (
        <InlineImageThumbCell
          globalSku={row.original.globalSku}
          originalName={row.original.originalName}
          imageUrl={row.original.catalog?.imageUrl ?? null}
          isNa={na.includes("image")}
          onSaved={(imageUrl, naFields) => {
            const base = row.original.catalog ?? {
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
            m.onPatchSaved(row.original.globalSku, {
              catalog: {
                ...base,
                imageUrl,
                naFields: naFields ?? base.naFields,
                updatedAt: new Date().toISOString(),
                updatedBy: getOperatorName(),
              },
            });
            if (naFields) m.onNaChange(row.original.globalSku, naFields);
          }}
        />
      );
    },
  });

  const descCol = col.display({
    id: "catalog_description",
    header: "Description",
    cell: ({ row, table }) => {
      const m = table.options.meta as DictionaryTableMeta;
      return (
        <InlineTextCell
          globalSku={row.original.globalSku}
          field="description"
          value={row.original.catalog?.description ?? ""}
          target="catalog"
          className="min-w-32"
          placeholder="Memo / description"
          onSaved={({ value, updatedAt, updatedBy }) => {
            const base = row.original.catalog ?? {
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
            m.onPatchSaved(row.original.globalSku, {
              catalog: {
                ...base,
                description: value || null,
                updatedAt,
                updatedBy,
              },
            });
          }}
        />
      );
    },
  });

  const fields: Array<{
    field: string;
    header: string;
    catalogKey: keyof NonNullable<SkuMappingRow["catalog"]>;
    allowNa: boolean;
  }> = [
    { field: "length", header: "L", catalogKey: "length", allowNa: true },
    { field: "depth", header: "W", catalogKey: "depth", allowNa: true },
    { field: "height", header: "H", catalogKey: "height", allowNa: true },
    {
      field: "sit_height",
      header: "Seat",
      catalogKey: "sitHeight",
      allowNa: true,
    },
    {
      field: "arm_height",
      header: "Arm",
      catalogKey: "armHeight",
      allowNa: true,
    },
    { field: "weight", header: "Wt", catalogKey: "weight", allowNa: true },
    { field: "msrp", header: "MSRP", catalogKey: "msrp", allowNa: true },
    ...(compact
      ? []
      : [
          {
            field: "qbo_item_code",
            header: "QBO",
            catalogKey: "qboItemCode" as const,
            allowNa: false,
          },
        ]),
  ];

  const dimCols = fields.map(({ field, header, catalogKey, allowNa }) =>
    col.display({
      id: `catalog_${field}`,
      header,
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        const na = row.original.catalog?.naFields ?? [];
        const missing = rowMissingCatalogTokens(row.original);
        const suggested = inferSuggestedNaFields({
          originalName: row.original.originalName,
          description: row.original.catalog?.description,
          globalSku: row.original.globalSku,
        });
        const isNaField =
          allowNa &&
          (na.includes(field) ||
            (suggested as readonly string[]).includes(field));
        const raw = row.original.catalog?.[catalogKey];
        const display = isNaField
          ? "N/A"
          : typeof raw === "string" || raw == null
            ? (raw ?? "")
            : String(raw);
        return (
          <InlineCatalogDimCell
            globalSku={row.original.globalSku}
            field={field}
            value={display}
            isNa={isNaField}
            allowNa={allowNa}
            compact={compact}
            highlightMissing={missing.has(field)}
            placeholder="—"
            onSaved={({ value, updatedAt, updatedBy, naFields }) => {
              const base = row.original.catalog ?? {
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
              const nextNa = naFields ?? base.naFields;
              const storedValue =
                allowNa &&
                (value.trim().toUpperCase() === "N/A" ||
                  nextNa.includes(field))
                  ? null
                  : value || null;
              m.onPatchSaved(row.original.globalSku, {
                catalog: {
                  ...base,
                  [catalogKey]: storedValue,
                  naFields: nextNa,
                  updatedAt,
                  updatedBy,
                },
              });
              if (naFields) {
                m.onNaChange(row.original.globalSku, naFields);
              }
            }}
          />
        );
      },
    }),
  );

  return compact ? [imageCol, ...dimCols] : [imageCol, ...dimCols, descCol];
}

function attributeColumns(
  tabKey: string,
): ColumnDef<SkuMappingRow, unknown>[] {
  const defs = buildAttrCols(tabKey);
  return defs.map(({ key, paths, writePath, header, selectOptions }) =>
    col.display({
      id: `attr_${key}`,
      header,
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        const current = resolveAttributeValue(row.original.attributes, paths);
        const missing = rowMissingAttributeKeys(row.original);
        if (selectOptions) {
          return (
            <EditableSelectCell
              globalSku={row.original.globalSku}
              field={writePath}
              value={current}
              options={selectOptions}
              target="attribute"
              expectedVersion={row.original.version}
              allowNa
              highlightMissing={missing.has(key)}
              onSaved={({ value, updatedAt, updatedBy, version }) => {
                const next = setAttributePath(
                  { ...row.original.attributes },
                  writePath,
                  value || null,
                );
                m.onPatchSaved(row.original.globalSku, {
                  attributes: next,
                  version,
                  mappingUpdatedAt: updatedAt,
                  mappingUpdatedBy: updatedBy,
                });
              }}
            />
          );
        }
        return (
          <InlineTextCell
            globalSku={row.original.globalSku}
            field={writePath}
            value={current}
            target="attribute"
            expectedVersion={row.original.version}
            allowNa
            highlightMissing={missing.has(key)}
            onSaved={({ value, updatedAt, updatedBy, version }) => {
              const next = setAttributePath(
                { ...row.original.attributes },
                writePath,
                value || null,
              );
              m.onPatchSaved(row.original.globalSku, {
                attributes: next,
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              });
            }}
          />
        );
      },
    }),
  ) as ColumnDef<SkuMappingRow, unknown>[];
}

/**
 * Dynamic column factory — projects category-specific attribute columns
 * based on the active dictionary tab.
 */
export function buildDictionaryColumns(
  activeTab: string,
  meta: DictionaryTableMeta,
): ColumnDef<SkuMappingRow, unknown>[] {
  const tabKey = normalizeTab(activeTab);
  const lean = leanCoreColumns(meta);
  const ecomm = ecommColumn();
  const health = healthColumn();
  const actions = actionsColumn();

  if (tabKey === "all" || !tabKey) {
    return [...lean, ecomm, health, actions];
  }

  if (tabKey === "finished good" || tabKey === "furniture") {
    return [...lean, ecomm, ...seatingCatalogColumns(true), health, actions];
  }

  const healthTab = resolveAttributeTabKey(activeTab);

  return [...lean, ecomm, ...attributeColumns(healthTab), health, actions];
}

function InspectIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
      <path
        fillRule="evenodd"
        d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 9.24A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-9.24.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.06 1.06L8.94 10 7.53 11.41a.75.75 0 101.06 1.06L10 11.06l1.41 1.41a.75.75 0 101.06-1.06L11.06 10l1.41-1.41a.75.75 0 00-1.06-1.06L10 8.94 8.58 7.72z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export { showBomForRow, EXEC_PILL };

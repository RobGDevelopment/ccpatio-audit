"use client";

import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { resolveAttributeTabKey } from "@/lib/raw-material-sku";
import { setAttributePath } from "@/server/pim/attributes/schemas";
import { CATEGORY_REQUIRED_ATTRIBUTES } from "@/server/pim/attributes/health";
import {
  EditableSelectCell,
  FABRIC_GRADE_OPTIONS,
  FIREPIT_FUEL_OPTIONS,
  FIREPIT_IGNITION_OPTIONS,
  formatAuditStamp,
  getOperatorName,
  InlineCatalogDimCell,
  InlineCategoryCell,
  InlineImageThumbCell,
  InlineTextCell,
  ITEM_TYPE_OPTIONS,
  METAL_ALLOY_OPTIONS,
  METAL_PROFILE_OPTIONS,
  SHADE_MOUNT_OPTIONS,
  SHADE_MOTOR_OPTIONS,
  UOM_OPTIONS,
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

function isCompactTab(activeTab: string): boolean {
  const tab = normalizeTab(activeTab);
  return tab === "finished good" || tab === "furniture";
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

function StatusToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${label}: ${checked ? "Active" : "Discontinued"}`}
      onClick={onChange}
      className={`${EXEC_PILL} ${
        checked
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
          : "border-slate-600/50 bg-slate-800/50 text-slate-400"
      }`}
    >
      {checked ? "Active" : "Killed"}
    </button>
  );
}

function DataHealthPunchlist({ row }: { row: SkuMappingRow }) {
  const health = rowHealth(row);

  if (health.hasMissingData) {
    const labels = [
      ...health.missingCatalogFields,
      ...health.missingAttributeFields,
    ];
    return (
      <div className="flex flex-col gap-0.5 items-start">
        <span
          className={`${EXEC_PILL} border-rose-500/25 bg-rose-500/10 text-rose-300`}
        >
          Missing Data
        </span>
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

function coreColumns(
  meta: DictionaryTableMeta,
): ColumnDef<SkuMappingRow, unknown>[] {
  return [
    col.display({
      id: "expand",
      header: "",
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        if (!showExpandForRow(row.original, row.original.category)) {
          return <span className="inline-block w-7" />;
        }
        const isOpen = Boolean(m.expanded[row.original.globalSku]);
        const fgTab = isCompactTab(row.original.category);
        return (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={fgTab ? "Toggle details" : "Toggle BOM panel"}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.2)] transition-all hover:bg-emerald-500/20 hover:shadow-[0_0_12px_rgba(16,185,129,0.4)]"
            onClick={() => m.onToggleExpand(row.original.globalSku)}
            title={fgTab ? "Description, integrations, BOM" : "Bill of materials"}
          >
            <span
              className={`text-sm transition-transform ${isOpen ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </button>
        );
      },
      size: 36,
    }),
    col.display({
      id: "status",
      header: "Status",
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        return (
          <StatusToggle
            checked={row.original.isActive}
            label={row.original.globalSku}
            onChange={() => m.onToggleActive(row.original.globalSku)}
          />
        );
      },
    }),
    col.accessor("globalSku", {
      header: "Global SKU",
      cell: ({ row }) => (
        <span
          className="whitespace-nowrap font-mono text-[11px] text-slate-100"
          title={row.original.globalSku}
        >
          {row.original.globalSku}
        </span>
      ),
    }),
    col.accessor("originalName", {
      header: "Factory Name",
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        return (
          <InlineTextCell
            globalSku={row.original.globalSku}
            field="original_name"
            value={row.original.originalName ?? ""}
            target="mapping"
            expectedVersion={row.original.version}
            variant="plain"
            className="max-w-56 truncate"
            placeholder="Factory name"
            onSaved={({ value, updatedAt, updatedBy, version }) =>
              m.onPatchSaved(row.original.globalSku, {
                originalName: value,
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              })
            }
          />
        );
      },
    }),
    col.accessor("category", {
      header: "Category",
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        return (
          <InlineCategoryCell
            globalSku={row.original.globalSku}
            value={row.original.category}
            options={m.categoryOptions}
            expectedVersion={row.original.version}
            onSaved={({ value, updatedAt, updatedBy, version }) =>
              m.onPatchSaved(row.original.globalSku, {
                category: value,
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              })
            }
          />
        );
      },
    }),
    col.accessor("itemType", {
      header: "Type",
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        return (
          <EditableSelectCell
            globalSku={row.original.globalSku}
            field="item_type"
            value={row.original.itemType}
            options={ITEM_TYPE_OPTIONS}
            target="mapping"
            expectedVersion={row.original.version}
            allowEmpty={false}
            onSaved={({ value, updatedAt, updatedBy, version }) =>
              m.onPatchSaved(row.original.globalSku, {
                itemType: value as SkuMappingRow["itemType"],
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              })
            }
          />
        );
      },
    }),
    col.display({
      id: "uom_purchase",
      header: "UOM buy",
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        const compact = isCompactTab(row.original.category);
        return (
          <EditableSelectCell
            globalSku={row.original.globalSku}
            field="uom_purchase"
            value={row.original.uomPurchase ?? ""}
            options={UOM_OPTIONS}
            target="mapping"
            expectedVersion={row.original.version}
            compact={compact}
            onSaved={({ value, updatedAt, updatedBy, version }) =>
              m.onPatchSaved(row.original.globalSku, {
                uomPurchase: value || null,
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              })
            }
          />
        );
      },
    }),
    col.display({
      id: "uom_consume",
      header: "UOM use",
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        const compact = isCompactTab(row.original.category);
        return (
          <EditableSelectCell
            globalSku={row.original.globalSku}
            field="uom_consume"
            value={row.original.uomConsume ?? ""}
            options={UOM_OPTIONS}
            target="mapping"
            expectedVersion={row.original.version}
            compact={compact}
            onSaved={({ value, updatedAt, updatedBy, version }) =>
              m.onPatchSaved(row.original.globalSku, {
                uomConsume: value || null,
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              })
            }
          />
        );
      },
    }),
    col.display({
      id: "base_cost",
      header: "Cost",
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        return (
          <InlineTextCell
            globalSku={row.original.globalSku}
            field="base_cost"
            value={row.original.baseCost ?? row.original.catalog?.cost ?? ""}
            target="mapping"
            expectedVersion={row.original.version}
            onSaved={({ value, updatedAt, updatedBy, version }) =>
              m.onPatchSaved(row.original.globalSku, {
                baseCost: value || null,
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              })
            }
          />
        );
      },
    }),
    // silence unused meta param in factory signature when only building core
    ...(meta ? [] : []),
  ] as ColumnDef<SkuMappingRow, unknown>[];
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

function trailingColumns(
  compact = false,
): ColumnDef<SkuMappingRow, unknown>[] {
  const healthCol = col.display({
    id: "data_health",
    header: "Data health",
    cell: ({ row }) => <DataHealthPunchlist row={row.original} />,
  });

  if (compact) {
    return [healthCol] as ColumnDef<SkuMappingRow, unknown>[];
  }

  return [
    col.display({
      id: "woo",
      header: "Woo Slug",
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        return (
          <InlineTextCell
            globalSku={row.original.globalSku}
            field="woo_attribute_slug"
            value={row.original.wooAttributeSlug ?? ""}
            target="mapping"
            expectedVersion={row.original.version}
            onSaved={({ value, updatedAt, updatedBy, version }) =>
              m.onPatchSaved(row.original.globalSku, {
                wooAttributeSlug: value || null,
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              })
            }
          />
        );
      },
    }),
    healthCol,
    col.display({
      id: "ghl",
      header: "GHL",
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        return (
          <InlineTextCell
            globalSku={row.original.globalSku}
            field="ghl_dropdown_value"
            value={row.original.ghlDropdownValue ?? ""}
            target="mapping"
            expectedVersion={row.original.version}
            onSaved={({ value, updatedAt, updatedBy, version }) =>
              m.onPatchSaved(row.original.globalSku, {
                ghlDropdownValue: value || null,
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              })
            }
          />
        );
      },
    }),
    col.accessor("bomComponentCount", {
      header: "BOM",
      cell: ({ getValue }) => (
        <span className="font-mono text-xs tabular-nums text-slate-400">
          {getValue()}
        </span>
      ),
    }),
    col.display({
      id: "audit",
      header: "Last Updated",
      cell: ({ row }) => {
        const stamp = formatAuditStamp(
          row.original.catalog?.updatedBy ?? row.original.mappingUpdatedBy,
          row.original.catalog?.updatedAt ?? row.original.mappingUpdatedAt,
        );
        return (
          <span
            className="max-w-36 text-[10px] leading-snug text-slate-500"
            title={stamp}
          >
            {stamp}
          </span>
        );
      },
    }),
  ] as ColumnDef<SkuMappingRow, unknown>[];
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
  const core = coreColumns(meta);

  if (tabKey === "all" || !tabKey) {
    return [...core, ...trailingColumns(false)];
  }

  if (tabKey === "finished good" || tabKey === "furniture") {
    return [...core, ...seatingCatalogColumns(true), ...trailingColumns(true)];
  }

  const healthTab = resolveAttributeTabKey(activeTab);

  return [...core, ...attributeColumns(healthTab), ...trailingColumns(false)];
}

export { showBomForRow, EXEC_PILL };

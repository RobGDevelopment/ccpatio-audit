"use client";

import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { getAttributePath, setAttributePath } from "@/server/pim/attributes/schemas";
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
  POWDER_GLOSS_OPTIONS,
  SHADE_MOUNT_OPTIONS,
  SHADE_MOTOR_OPTIONS,
  UOM_OPTIONS,
} from "./InlineCells";
import { inferSuggestedNaFields, getMissingCatalogFields } from "./pim-catalog-utils";
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

function rowMissingFields(row: SkuMappingRow): Set<string> {
  return new Set(
    getMissingCatalogFields({
      category: row.category,
      itemType: row.itemType,
      originalName: row.originalName,
      globalSku: row.globalSku,
      catalog: row.catalog,
    }),
  );
}

type AttrCol = {
  path: string;
  header: string;
  minWidth?: string;
  selectOptions?: ReadonlyArray<string | { value: string; label: string }>;
};

const ATTR_COLS: Record<string, AttrCol[]> = {
  dekton: [
    { path: "slab_dims.l", header: "Slab L" },
    { path: "slab_dims.w", header: "Slab W" },
    { path: "thickness_mm", header: "Thick mm" },
    {
      path: "finish",
      header: "Finish",
      selectOptions: ["Matte", "Polished", "Textured", "Satin"],
    },
    { path: "yield_sqft", header: "Yield sqft" },
    { path: "routing_factor", header: "Route ×" },
  ],
  fabric: [
    { path: "roll_width_in", header: "Roll W" },
    {
      path: "fabric_grade",
      header: "Grade",
      selectOptions: FABRIC_GRADE_OPTIONS,
    },
    { path: "yield_factor", header: "Yield ×" },
    { path: "pattern.colorway", header: "Colorway" },
  ],
  metal: [
    {
      path: "alloy_temper",
      header: "Alloy",
      selectOptions: METAL_ALLOY_OPTIONS,
    },
    {
      path: "profile_type",
      header: "Profile",
      selectOptions: METAL_PROFILE_OPTIONS,
    },
    { path: "stick_len_in", header: "Stick in" },
    { path: "wall_thick", header: "Wall" },
    { path: "weight_plf", header: "lb/ft" },
  ],
  powder: [
    { path: "ral_code", header: "RAL" },
    { path: "brand_color.color_name", header: "Color" },
    {
      path: "aesthetics.gloss",
      header: "Gloss",
      selectOptions: POWDER_GLOSS_OPTIONS,
    },
    { path: "coverage_sqft_per_lb", header: "Cov sqft/lb" },
    { path: "cure_schedule.temp_f", header: "Cure °F" },
    { path: "cure_schedule.time_min", header: "Cure min" },
  ],
  shade: [
    { path: "span_dims.w", header: "Span W" },
    { path: "span_dims.l", header: "Span L" },
    { path: "shade_specs.wind_load", header: "Wind" },
    {
      path: "shade_specs.mount_cfg",
      header: "Mount",
      selectOptions: SHADE_MOUNT_OPTIONS,
    },
    {
      path: "shade_specs.motor",
      header: "Motor",
      selectOptions: SHADE_MOTOR_OPTIONS,
    },
  ],
  firepit: [
    { path: "fire_specs.btu", header: "BTU" },
    {
      path: "fire_specs.fuel",
      header: "Fuel",
      selectOptions: FIREPIT_FUEL_OPTIONS,
    },
    { path: "fire_specs.burner", header: "Burner" },
    {
      path: "fire_specs.ignition",
      header: "Ignition",
      selectOptions: FIREPIT_IGNITION_OPTIONS,
    },
  ],
  furniture: [
    { path: "taxonomy.collection", header: "Collection" },
    { path: "dimensions.l", header: "L" },
    { path: "dimensions.d", header: "D" },
    { path: "dimensions.h", header: "H" },
    { path: "weight_lbs", header: "Wt" },
  ],
  "finished good": [
    { path: "taxonomy.collection", header: "Collection" },
    { path: "dimensions.l", header: "L" },
    { path: "dimensions.d", header: "D" },
    { path: "dimensions.h", header: "H" },
    { path: "weight_lbs", header: "Wt" },
  ],
};

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

function KatanaPunchlist({ row }: { row: SkuMappingRow }) {
  const needsCatalogHealth =
    row.category.trim().toLowerCase() === "finished good" ||
    row.itemType === "finished_good";
  const catalogOk = isFinishedGoodCatalogComplete(row);
  const variantId = row.katanaVariantId;
  const materialId = row.katanaMaterialId;
  const hasKatana = variantId !== null || materialId !== null;

  // FG: blank required dims (unless in na_fields) → rose Missing
  if (needsCatalogHealth && !catalogOk) {
    return (
      <span
        className={`${EXEC_PILL} border-rose-500/25 bg-rose-500/10 text-rose-300`}
        title="Required catalog fields are blank (type N/A if not applicable; images optional)"
      >
        Missing
      </span>
    );
  }

  if (hasKatana) {
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className={`${EXEC_PILL} border-emerald-500/25 bg-emerald-500/10 text-emerald-300`}
        >
          Active
        </span>
        <div className="font-mono text-[11px] text-slate-400">
          {variantId !== null ? <span>v:{variantId}</span> : null}
          {materialId !== null ? (
            <span className={variantId !== null ? "ml-1" : undefined}>
              m:{materialId}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  // FG catalog complete but not yet synced — green Active (not a false Missing)
  if (needsCatalogHealth) {
    return (
      <span
        className={`${EXEC_PILL} border-emerald-500/25 bg-emerald-500/10 text-emerald-300`}
        title="Catalog complete — ready to sync to Katana"
      >
        Active
      </span>
    );
  }

  return (
    <span
      className={`${EXEC_PILL} border-rose-500/25 bg-rose-500/10 text-rose-300`}
      title="No Katana variant / material ID mapped"
    >
      Missing
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
        if (!showExpandForRow(row.original, m.activeTab)) {
          return <span className="inline-block w-7" />;
        }
        const isOpen = Boolean(m.expanded[row.original.globalSku]);
        const fgTab = isCompactTab(m.activeTab);
        return (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={fgTab ? "Toggle details" : "Toggle BOM panel"}
            onClick={() => m.onToggleExpand(row.original.globalSku)}
            className="inline-flex h-9 w-9 items-center justify-center text-emerald-400 hover:text-emerald-300 rounded-full bg-emerald-500/10 shadow-[0_0_8px_rgba(16,185,129,0.3)] transition-all hover:shadow-[0_0_12px_rgba(16,185,129,0.5)]"
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
            className="max-w-[14rem] truncate"
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
        const compact = isCompactTab(m.activeTab);
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
        const compact = isCompactTab(m.activeTab);
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
          className="min-w-[8rem]"
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
    { field: "depth", header: "D", catalogKey: "depth", allowNa: true },
    { field: "height", header: "H", catalogKey: "height", allowNa: true },
    {
      field: "sit_height",
      header: "Sit",
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
        const missing = rowMissingFields(row.original);
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
  const defs = ATTR_COLS[tabKey] ?? [];
  return defs.map(({ path, header, selectOptions }) =>
    col.display({
      id: `attr_${path}`,
      header,
      cell: ({ row, table }) => {
        const m = table.options.meta as DictionaryTableMeta;
        const current = getAttributePath(row.original.attributes, path);
        if (selectOptions) {
          return (
            <EditableSelectCell
              globalSku={row.original.globalSku}
              field={path}
              value={current}
              options={selectOptions}
              target="attribute"
              expectedVersion={row.original.version}
              onSaved={({ value, updatedAt, updatedBy, version }) => {
                const next = setAttributePath(
                  { ...row.original.attributes },
                  path,
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
            field={path}
            value={current}
            target="attribute"
            expectedVersion={row.original.version}
            onSaved={({ value, updatedAt, updatedBy, version }) => {
              const next = setAttributePath(
                { ...row.original.attributes },
                path,
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
  const katanaCol = col.display({
    id: "katana",
    header: "Katana",
    cell: ({ row }) => <KatanaPunchlist row={row.original} />,
  });

  if (compact) {
    return [katanaCol] as ColumnDef<SkuMappingRow, unknown>[];
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
    katanaCol,
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
            className="max-w-[9rem] text-[10px] leading-snug text-slate-500"
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

  return [...core, ...attributeColumns(tabKey), ...trailingColumns(false)];
}

export { showBomForRow, EXEC_PILL };

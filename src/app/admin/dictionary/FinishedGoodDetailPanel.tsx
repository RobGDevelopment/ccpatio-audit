"use client";

import { BomPanel } from "./BomPanel";
import { formatAuditStamp, InlineTextCell } from "./InlineCells";
import type { DictionaryTableMeta, SkuMappingRow } from "./types";

type FinishedGoodDetailPanelProps = {
  row: SkuMappingRow;
  meta: DictionaryTableMeta;
};

function emptyCatalog(row: SkuMappingRow) {
  return (
    row.catalog ?? {
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
    }
  );
}

export function FinishedGoodDetailPanel({
  row,
  meta,
}: FinishedGoodDetailPanelProps) {
  const stamp = formatAuditStamp(
    row.catalog?.updatedBy ?? row.mappingUpdatedBy,
    row.catalog?.updatedAt ?? row.mappingUpdatedAt,
  );
  const base = emptyCatalog(row);

  return (
    <div className="space-y-5 rounded-xl border border-slate-800/80 bg-slate-950/50 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.55fr))_auto] lg:items-end">
        <label className="block min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Description
          </span>
          <InlineTextCell
            globalSku={row.globalSku}
            field="description"
            value={row.catalog?.description ?? ""}
            target="catalog"
            variant="plain"
            className="min-w-0"
            placeholder="Memo / description"
            onSaved={({ value, updatedAt, updatedBy }) => {
              meta.onPatchSaved(row.globalSku, {
                catalog: {
                  ...base,
                  description: value || null,
                  updatedAt,
                  updatedBy,
                },
              });
            }}
          />
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            QBO
          </span>
          <InlineTextCell
            globalSku={row.globalSku}
            field="qbo_item_code"
            value={row.catalog?.qboItemCode ?? ""}
            target="catalog"
            variant="plain"
            placeholder="QBO code"
            onSaved={({ value, updatedAt, updatedBy }) => {
              meta.onPatchSaved(row.globalSku, {
                catalog: {
                  ...base,
                  qboItemCode: value || null,
                  updatedAt,
                  updatedBy,
                },
              });
            }}
          />
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Woo Slug
          </span>
          <InlineTextCell
            globalSku={row.globalSku}
            field="woo_attribute_slug"
            value={row.wooAttributeSlug ?? ""}
            target="mapping"
            expectedVersion={row.version}
            variant="plain"
            onSaved={({ value, updatedAt, updatedBy, version }) => {
              meta.onPatchSaved(row.globalSku, {
                wooAttributeSlug: value || null,
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              });
            }}
          />
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            GHL
          </span>
          <InlineTextCell
            globalSku={row.globalSku}
            field="ghl_dropdown_value"
            value={row.ghlDropdownValue ?? ""}
            target="mapping"
            expectedVersion={row.version}
            variant="plain"
            onSaved={({ value, updatedAt, updatedBy, version }) => {
              meta.onPatchSaved(row.globalSku, {
                ghlDropdownValue: value || null,
                version,
                mappingUpdatedAt: updatedAt,
                mappingUpdatedBy: updatedBy,
              });
            }}
          />
        </label>
        <div className="text-[10px] leading-snug text-slate-500 lg:pb-1">
          <span className="block font-medium uppercase tracking-wider text-slate-500">
            Last Updated
          </span>
          <span title={stamp}>{stamp}</span>
          <span className="mt-1 block font-mono text-slate-400">
            BOM lines: {row.bomComponentCount}
          </span>
        </div>
      </div>

      {(row.itemType === "finished_good" || row.itemType === "sub_assembly") && (
        <BomPanel productSku={row.globalSku} itemType={row.itemType} />
      )}
    </div>
  );
}

"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { PimDisclosure } from "@/app/admin/shared/PimDisclosure";
import type { BomTreeNode, DraftBomLine, DraftOperationRow } from "./actions";
import { BomMaterialRow } from "./BomMaterialRow";
import { BomOperationsPanel } from "./BomOperationsPanel";
import {
  PIM_INPUT,
  UNIT_OPTIONS,
  assemblyBadge,
  card,
  statusClass,
  tactileButton,
} from "./factory-bom-ui";

type AddFormState = {
  childSku: string;
  quantity: string;
  scrap: string;
  uom: string;
};

type Props = {
  node: BomTreeNode;
  lines: DraftBomLine[];
  ops: DraftOperationRow[];
  level: 1 | 2;
  defaultOpen?: boolean;
  isPending: boolean;
  isActiveAddTarget?: boolean;
  materialCombobox: (props: {
    value: string;
    onChange: (sku: string, hit?: { uom?: string | null }) => void;
    disabled?: boolean;
  }) => ReactNode;
  nestedCards?: ReactNode;
  onActivate?: () => void;
  onSaveLine: (
    line: DraftBomLine,
    next: {
      quantity: string;
      scrapFactor: string;
      unitOfMeasure: string;
      notes: string;
      cutList: import("@/lib/sketchup-cutlist/types").CutLine[];
    },
  ) => void;
  onRemoveLine: (id: string) => void;
  onAddLine: (data: {
    parentSku: string;
    childSku: string;
    quantity: string;
    scrapFactor: string;
    unitOfMeasure: string;
  }) => void;
  onAddOp: (data: {
    itemSku: string;
    workCenter: string;
    sequence: number;
    setupTimeMins: string;
    runTimeMins: string;
  }) => void;
  onUpdateOp: (data: {
    id: string;
    itemSku: string;
    workCenter: string;
    sequence: number;
    setupTimeMins: string;
    runTimeMins: string;
  }) => void;
  onRemoveOp: (id: string) => void;
  onApplyTrack: (itemSku: string, trackId: import("@/lib/factory-routing/resources").StandardTrackId) => void;
};

export function BomAssemblyCard({
  node,
  lines,
  ops,
  level,
  defaultOpen = true,
  isPending,
  isActiveAddTarget = false,
  materialCombobox,
  nestedCards,
  onActivate,
  onSaveLine,
  onRemoveLine,
  onAddLine,
  onAddOp,
  onUpdateOp,
  onRemoveOp,
  onApplyTrack,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [addForm, setAddForm] = useState<AddFormState>({
    childSku: "",
    quantity: "1",
    scrap: "1.0000",
    uom: "ea",
  });

  const badge = assemblyBadge(node.sku, node.itemType);
  const shellClass =
    level === 1
      ? `${card} overflow-hidden`
      : "overflow-hidden rounded-xl border border-slate-100 bg-slate-50";

  function handleAdd(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!addForm.childSku.trim()) return;
    onAddLine({
      parentSku: node.sku,
      childSku: addForm.childSku,
      quantity: addForm.quantity,
      scrapFactor: addForm.scrap,
      unitOfMeasure: addForm.uom,
    });
    setAddForm({ childSku: "", quantity: "1", scrap: "1.0000", uom: "ea" });
  }

  const materialLines = lines.filter((line) => line.childItemType !== "sub_assembly");

  return (
    <div className={shellClass}>
      <PimDisclosure
        open={open}
        onToggle={() => setOpen((prev) => !prev)}
        onActivate={onActivate}
        buttonTestId={`factory-bom-parent-${node.sku}`}
        tone="soft"
        title={
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
              {badge}
            </span>
            <span className="text-sm font-semibold text-slate-800">{node.name}</span>
          </div>
        }
        subtitle={
          <p className="font-mono text-[11px] text-slate-500">{node.sku}</p>
        }
        badge={
          <span
            className={statusClass(materialLines[0]?.status ?? "none")}
          >
            {materialLines.length} materials
          </span>
        }
      >
        <div className="space-y-3">
          {materialLines.length === 0 ? (
            <p className="py-2 text-sm text-slate-500">
              No draft materials on this node. Add a raw material below.
            </p>
          ) : (
            materialLines.map((line) => (
              <BomMaterialRow
                key={line.id}
                line={line}
                isPending={isPending}
                onSave={(next) => onSaveLine(line, next)}
                onRemove={() => onRemoveLine(line.id)}
              />
            ))
          )}

          <form
            onSubmit={handleAdd}
            className="grid grid-cols-1 gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 md:grid-cols-12"
          >
            <div className="md:col-span-5">
              {materialCombobox({
                value: addForm.childSku,
                disabled: isPending,
                onChange: (sku, hit) => {
                  setAddForm((prev) => ({
                    ...prev,
                    childSku: sku,
                    uom: hit?.uom ? hit.uom.toLowerCase() : prev.uom,
                  }));
                },
              })}
            </div>
            <input
              data-testid={isActiveAddTarget ? "factory-bom-add-qty" : undefined}
              value={addForm.quantity}
              onChange={(e) =>
                setAddForm((prev) => ({ ...prev, quantity: e.target.value }))
              }
              className={`${PIM_INPUT} md:col-span-2`}
              placeholder="Qty"
            />
            <input
              value={addForm.scrap}
              onChange={(e) =>
                setAddForm((prev) => ({ ...prev, scrap: e.target.value }))
              }
              className={`${PIM_INPUT} md:col-span-2`}
              placeholder="Scrap"
            />
            <select
              value={addForm.uom}
              onChange={(e) =>
                setAddForm((prev) => ({ ...prev, uom: e.target.value }))
              }
              className={`${PIM_INPUT} md:col-span-2`}
            >
              {UNIT_OPTIONS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
            <button
              type="submit"
              data-testid={isActiveAddTarget ? "factory-bom-add-line" : undefined}
              disabled={isPending || !addForm.childSku}
              className={`${tactileButton} px-4 py-2 text-sm disabled:opacity-40 md:col-span-1`}
            >
              Add
            </button>
          </form>

          <BomOperationsPanel
            itemSku={node.sku}
            ops={ops}
            isPending={isPending}
            onAdd={(draft) =>
              onAddOp({
                itemSku: node.sku,
                ...draft,
              })
            }
            onUpdate={(draft) =>
              onUpdateOp({
                itemSku: node.sku,
                ...draft,
              })
            }
            onRemove={onRemoveOp}
            onApplyTrack={(trackId) => onApplyTrack(node.sku, trackId)}
          />
        </div>
      </PimDisclosure>

      {nestedCards ? (
        <div className="space-y-3 border-l border-slate-100 pl-3 pt-2">
          {nestedCards}
        </div>
      ) : null}
    </div>
  );
}

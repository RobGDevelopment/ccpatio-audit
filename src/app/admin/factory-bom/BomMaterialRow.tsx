"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import type { DraftBomLine } from "./actions";
import { PIM_INPUT, UNIT_OPTIONS, statusClass, statusLabel } from "./factory-bom-ui";

type Props = {
  line: DraftBomLine;
  isPending: boolean;
  onSave: (next: {
    quantity: string;
    scrapFactor: string;
    unitOfMeasure: string;
    notes: string;
  }) => void;
  onRemove: () => void;
};

export function BomMaterialRow({ line, isPending, onSave, onRemove }: Props) {
  const [quantity, setQuantity] = useState(String(Number(line.quantity)));
  const [scrap, setScrap] = useState(String(Number(line.scrapFactor)));
  const [uom, setUom] = useState(line.unitOfMeasure);
  const [notes, setNotes] = useState(line.notes ?? "");

  useEffect(() => {
    setQuantity(String(Number(line.quantity)));
    setScrap(String(Number(line.scrapFactor)));
    setUom(line.unitOfMeasure);
    setNotes(line.notes ?? "");
  }, [line.id, line.quantity, line.scrapFactor, line.unitOfMeasure, line.notes]);

  function commitIfChanged(): void {
    const nextQty = quantity.trim();
    const nextScrap = scrap.trim();
    const nextUom = uom.trim().toLowerCase();
    const nextNotes = notes;
    const same =
      Number(nextQty) === Number(line.quantity) &&
      Number(nextScrap) === Number(line.scrapFactor) &&
      nextUom === line.unitOfMeasure.toLowerCase() &&
      nextNotes.trim() === (line.notes ?? "").trim();
    if (same) return;
    if (!nextQty || !Number.isFinite(Number(nextQty))) return;
    onSave({
      quantity: nextQty,
      scrapFactor: nextScrap || "1",
      unitOfMeasure: nextUom || "ea",
      notes: nextNotes,
    });
  }

  function onEnterBlur(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement && !event.metaKey && !event.ctrlKey)) {
      if (event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      (event.target as HTMLInputElement).blur();
    }
  }

  const notesEmpty = !notes.trim();

  return (
    <div
      data-testid={`factory-bom-line-${line.childSku}`}
      className="rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3 transition hover:bg-zinc-900/40"
    >
      <div className="grid grid-cols-12 items-start gap-2">
        <div className="col-span-12 min-w-0 sm:col-span-5">
          <div className="text-sm font-medium text-zinc-100">{line.childName}</div>
          <div className="font-mono text-[11px] text-zinc-500">
            {line.childSku} · {line.childItemType.replace(/_/g, " ")}
          </div>
        </div>
        <label className="col-span-4 sm:col-span-2">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
            Qty
          </span>
          <input
            data-testid={`factory-bom-qty-${line.childSku}`}
            aria-label={`Quantity for ${line.childSku}`}
            value={quantity}
            disabled={isPending}
            className={`${PIM_INPUT} font-mono`}
            onChange={(e) => setQuantity(e.target.value)}
            onBlur={commitIfChanged}
            onKeyDown={onEnterBlur}
          />
        </label>
        <label className="col-span-4 sm:col-span-2">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
            Scrap
          </span>
          <input
            aria-label={`Scrap for ${line.childSku}`}
            value={scrap}
            disabled={isPending}
            className={`${PIM_INPUT} font-mono`}
            onChange={(e) => setScrap(e.target.value)}
            onBlur={commitIfChanged}
            onKeyDown={onEnterBlur}
          />
        </label>
        <label className="col-span-4 sm:col-span-2">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">
            UOM
          </span>
          <select
            aria-label={`UOM for ${line.childSku}`}
            value={uom}
            disabled={isPending}
            className={`${PIM_INPUT} uppercase`}
            onChange={(e) => {
              setUom(e.target.value);
            }}
            onBlur={commitIfChanged}
          >
            {UNIT_OPTIONS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
            {!UNIT_OPTIONS.includes(uom as (typeof UNIT_OPTIONS)[number]) ? (
              <option value={uom}>{uom}</option>
            ) : null}
          </select>
        </label>
        <div className="col-span-12 flex items-center justify-between gap-2 sm:col-span-1 sm:flex-col sm:items-end sm:justify-start">
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] ${statusClass(line.status)}`}
          >
            {statusLabel(line.status)}
          </span>
          <button
            type="button"
            disabled={isPending}
            onClick={onRemove}
            className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-[10px] uppercase tracking-wider text-amber-400/80">
          Cut-list / chop-saw notes
        </span>
        <textarea
          aria-label={`Notes for ${line.childSku}`}
          value={notes}
          disabled={isPending}
          rows={2}
          placeholder="Cut 2x 34 inches 45/45"
          className={`pim-input min-h-16 w-full resize-y py-2 text-sm ${
            notesEmpty ? "border-amber-500/20" : ""
          }`}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitIfChanged}
        />
      </label>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  endsLabel,
  formatFloorCutCard,
  parseFreeTextCutCards,
  resolveDraftCutsAndNote,
} from "@/lib/sketchup-cutlist/notes-codec";
import { formatDrawingPartNumber } from "@/lib/sketchup-cutlist/parse-component-name";
import type { CutLine, LengthConvention, ProfileCode } from "@/lib/sketchup-cutlist/types";
import type { DraftBomLine } from "./actions";
import {
  CONVENTION_OPTIONS,
  PIM_INPUT,
  PROFILE_OPTIONS,
  UNIT_OPTIONS,
  statusClass,
  statusLabel,
} from "./factory-bom-ui";

type Props = {
  line: DraftBomLine;
  isPending: boolean;
  onSave: (next: {
    quantity: string;
    scrapFactor: string;
    unitOfMeasure: string;
    notes: string;
    cutList: CutLine[];
  }) => void;
  onRemove: () => void;
};

function blankCut(): CutLine {
  return {
    role: "",
    profile: "UNKNOWN",
    lengthIn: 0,
    endA: 90,
    endB: 90,
    qtyEa: 1,
    lengthConvention: "square",
    sourceName: "",
    confidence: "stated",
    drawingPartNumber: null,
  };
}

function cutsEqual(a: CutLine[], b: CutLine[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function regenPartNumber(cut: CutLine): CutLine {
  return {
    ...cut,
    drawingPartNumber: formatDrawingPartNumber({
      profile: cut.profile,
      lengthIn: cut.lengthIn,
      endA: cut.endA,
      endB: cut.endB,
    }),
  };
}

export function BomMaterialRow({ line, isPending, onSave, onRemove }: Props) {
  const [quantity, setQuantity] = useState(String(Number(line.quantity)));
  const [scrap, setScrap] = useState(String(Number(line.scrapFactor)));
  const [uom, setUom] = useState(line.unitOfMeasure);
  const [managerNote, setManagerNote] = useState("");
  const [cuts, setCuts] = useState<CutLine[]>([]);
  const convertedKey = useRef<string | null>(null);

  useEffect(() => {
    setQuantity(String(Number(line.quantity)));
    setScrap(String(Number(line.scrapFactor)));
    setUom(line.unitOfMeasure);
    const resolved = resolveDraftCutsAndNote({
      notes: line.notes,
      cutList: line.cutList,
    });

    if (resolved.cutList.length > 0) {
      setManagerNote(resolved.managerNote);
      setCuts(resolved.cutList);
      return;
    }

    const parsed = parseFreeTextCutCards(resolved.managerNote);
    if (parsed.cutList.length === 0) {
      setManagerNote(resolved.managerNote);
      setCuts([]);
      return;
    }

    setManagerNote(parsed.remainder);
    setCuts(parsed.cutList);
    if (convertedKey.current === line.id) return;
    convertedKey.current = line.id;
    onSave({
      quantity: String(Number(line.quantity)),
      scrapFactor: String(Number(line.scrapFactor)),
      unitOfMeasure: line.unitOfMeasure,
      notes: parsed.remainder,
      cutList: parsed.cutList,
    });
    // onSave is an inline lambda from the assembly card; convert once per line id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.id, line.quantity, line.scrapFactor, line.unitOfMeasure, line.notes, line.cutList]);

  function persist(nextCuts: CutLine[], nextNote: string): void {
    onSave({
      quantity: quantity.trim() || String(Number(line.quantity)),
      scrapFactor: scrap.trim() || "1",
      unitOfMeasure: uom.trim().toLowerCase() || "ea",
      notes: nextNote.trim(),
      cutList: nextCuts,
    });
  }

  function commitIfChanged(): void {
    const nextQty = quantity.trim();
    const nextScrap = scrap.trim();
    const nextUom = uom.trim().toLowerCase();
    const nextNote = managerNote.trim();
    const same =
      Number(nextQty) === Number(line.quantity) &&
      Number(nextScrap) === Number(line.scrapFactor) &&
      nextUom === line.unitOfMeasure.toLowerCase() &&
      nextNote === (line.notes ?? "").trim() &&
      cutsEqual(cuts, line.cutList ?? []);
    if (same) return;
    if (!nextQty || !Number.isFinite(Number(nextQty))) return;
    persist(cuts, nextNote);
  }

  function onEnterBlur(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement && !event.metaKey && !event.ctrlKey)) {
      if (event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      (event.target as HTMLInputElement).blur();
    }
  }

  function patchCut(index: number, patch: Partial<CutLine>): void {
    setCuts((prev) =>
      prev.map((row, i) => (i === index ? regenPartNumber({ ...row, ...patch }) : row)),
    );
  }

  function convertLegacyNote(): void {
    const parsed = parseFreeTextCutCards(managerNote);
    if (parsed.cutList.length === 0) return;
    setCuts(parsed.cutList);
    setManagerNote(parsed.remainder);
    persist(parsed.cutList, parsed.remainder);
  }

  const noteEmpty = !managerNote.trim() && cuts.length === 0;
  const showCutCards = cuts.length > 0;
  const canConvert =
    !showCutCards && parseFreeTextCutCards(managerNote).cutList.length > 0;

  return (
    <div
      data-testid={`factory-bom-line-${line.childSku}`}
      className="rounded-lg border border-slate-100 bg-white p-3 transition hover:bg-slate-50"
    >
      <div className="grid grid-cols-12 items-start gap-2">
        <div className="col-span-12 min-w-0 sm:col-span-5">
          <div className="text-sm font-medium text-slate-800">{line.childName}</div>
          <div className="font-mono text-[11px] text-slate-500">
            {line.childSku} · {line.childItemType.replace(/_/g, " ")}
          </div>
        </div>
        <label className="col-span-4 sm:col-span-2">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
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
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
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
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
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
            className={statusClass(line.status)}
          >
            {statusLabel(line.status)}
          </span>
          <button
            type="button"
            disabled={isPending}
            onClick={onRemove}
            className="text-xs text-rose-600 hover:text-rose-700 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>

      {showCutCards ? (
        <div
          className="mt-3 overflow-x-auto rounded-lg border border-slate-100"
          data-testid={`factory-bom-cut-cards-${line.childSku}`}
        >
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
            Cut list
          </div>
          <table className="w-full min-w-[40rem] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2 font-medium">Qty</th>
                <th className="px-2 py-2 font-medium">Length (in)</th>
                <th className="px-2 py-2 font-medium">Profile</th>
                <th className="px-2 py-2 font-medium">Mitre</th>
                <th className="px-2 py-2 font-medium">Conv</th>
                <th className="px-2 py-2 font-medium">Summary</th>
                <th className="px-2 py-2 font-medium">Part #</th>
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {cuts.map((cut, index) => (
                <tr
                  key={`${cut.drawingPartNumber ?? cut.role}-${index}`}
                  className="border-b border-slate-100"
                  data-testid={`factory-bom-cut-row-${line.childSku}-${index}`}
                >
                  <td className="px-2 py-1.5">
                    <input
                      aria-label={`Cut qty ${index + 1} for ${line.childSku}`}
                      disabled={isPending}
                      value={String(cut.qtyEa)}
                      className={`${PIM_INPUT} w-14 font-mono`}
                      onChange={(e) =>
                        patchCut(index, { qtyEa: Number(e.target.value) || 0 })
                      }
                      onBlur={commitIfChanged}
                      onKeyDown={onEnterBlur}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      aria-label={`Cut length ${index + 1} for ${line.childSku}`}
                      disabled={isPending}
                      value={String(cut.lengthIn)}
                      className={`${PIM_INPUT} w-20 font-mono`}
                      onChange={(e) =>
                        patchCut(index, {
                          lengthIn: Number(e.target.value) || 0,
                        })
                      }
                      onBlur={commitIfChanged}
                      onKeyDown={onEnterBlur}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      aria-label={`Cut profile ${index + 1} for ${line.childSku}`}
                      disabled={isPending}
                      value={cut.profile}
                      className={`${PIM_INPUT} min-w-28 font-mono`}
                      data-testid={`factory-bom-cut-profile-${line.childSku}-${index}`}
                      onChange={(e) =>
                        patchCut(index, {
                          profile: e.target.value as ProfileCode,
                        })
                      }
                      onBlur={commitIfChanged}
                    >
                      {PROFILE_OPTIONS.map((profile) => (
                        <option key={profile} value={profile}>
                          {profile}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      aria-label={`Cut mitre ${index + 1} for ${line.childSku}`}
                      disabled={isPending}
                      value={`${cut.endA ?? 90}/${cut.endB ?? 90}`}
                      className={PIM_INPUT}
                      onChange={(e) => {
                        const [a, b] = e.target.value.split("/").map(Number);
                        patchCut(index, {
                          endA: a === 45 ? 45 : 90,
                          endB: b === 45 ? 45 : 90,
                        });
                      }}
                      onBlur={commitIfChanged}
                    >
                      <option value="90/90">{endsLabel(90, 90)}</option>
                      <option value="45/45">{endsLabel(45, 45)}</option>
                      <option value="45/90">{endsLabel(45, 90)}</option>
                      <option value="90/45">{endsLabel(90, 45)}</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      aria-label={`Cut convention ${index + 1} for ${line.childSku}`}
                      disabled={isPending}
                      value={cut.lengthConvention}
                      className={`${PIM_INPUT} w-16`}
                      data-testid={`factory-bom-cut-conv-${line.childSku}-${index}`}
                      onChange={(e) =>
                        patchCut(index, {
                          lengthConvention: e.target.value as LengthConvention,
                        })
                      }
                      onBlur={commitIfChanged}
                    >
                      {CONVENTION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">
                    {formatFloorCutCard(cut)}
                  </td>
                  <td
                    className="px-2 py-1.5 font-mono text-[11px] text-slate-500"
                    data-testid={`factory-bom-cut-part-${line.childSku}-${index}`}
                  >
                    {(cut.drawingPartNumber ?? cut.role) || "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      disabled={isPending}
                      className="text-[11px] text-slate-500 hover:text-rose-600 disabled:opacity-40"
                      onClick={() => {
                        const nextCuts = cuts.filter((_, i) => i !== index);
                        setCuts(nextCuts);
                        persist(nextCuts, managerNote);
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end border-t border-slate-100 px-2 py-1.5">
            <button
              type="button"
              disabled={isPending}
              data-testid={`factory-bom-add-cut-${line.childSku}`}
              className="text-[11px] text-emerald-700 hover:text-emerald-800 disabled:opacity-40"
              onClick={() => setCuts((prev) => [...prev, blankCut()])}
            >
              + Add cut row
            </button>
          </div>
        </div>
      ) : null}

      <label className="mt-3 block">
        <span className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
          <span>{showCutCards ? "Manager note" : "Cut-list / chop-saw notes"}</span>
          {canConvert ? (
            <button
              type="button"
              disabled={isPending}
              data-testid={`factory-bom-convert-cuts-${line.childSku}`}
              className="text-[10px] font-medium uppercase tracking-wider text-emerald-700 hover:text-emerald-800 disabled:opacity-40"
              onClick={convertLegacyNote}
            >
              Convert to cut cards
            </button>
          ) : null}
        </span>
        <textarea
          data-testid={`factory-bom-manager-note-${line.childSku}`}
          aria-label={`Manager note for ${line.childSku}`}
          value={managerNote}
          disabled={isPending}
          rows={2}
          placeholder={
            showCutCards
              ? "Optional floor note (human text only — never paste JSON)"
              : "Cut 2x 34 inches 45/45"
          }
          className={`${PIM_INPUT} min-h-16 resize-y ${
            noteEmpty ? "ring-amber-200" : ""
          }`}
          onChange={(e) => setManagerNote(e.target.value)}
          onBlur={commitIfChanged}
        />
      </label>
    </div>
  );
}

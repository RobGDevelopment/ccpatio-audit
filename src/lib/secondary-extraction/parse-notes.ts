import type { CutListPiece } from "./types";
import { splitBomNotes } from "@/lib/sketchup-cutlist/notes-codec";

/**
 * Parse cut_list JSON trailer appended to product_bom_draft.notes.
 * Thin projection over the shared notes-codec (FACTORY_BOM_KATANA_UX_PLAN Phase 1).
 */
export function parseCutListFromNotes(notes: string | null | undefined): {
  plainNotes: string | null;
  cutList: CutListPiece[];
} {
  const { managerNote, cutList } = splitBomNotes(notes);
  return {
    plainNotes: managerNote || null,
    cutList: cutList.map((c) => ({
      lengthIn: c.lengthIn,
      qtyEa: c.qtyEa,
      ...(c.profile !== "UNKNOWN" ? { profileCode: c.profile } : {}),
    })),
  };
}

export function sumCutListFeet(cuts: CutListPiece[]): number {
  return cuts.reduce((sum, cut) => sum + (cut.lengthIn / 12) * cut.qtyEa, 0);
}

export function sumCutListPieces(cuts: CutListPiece[]): number {
  return cuts.reduce((sum, cut) => sum + cut.qtyEa, 0);
}

export function sumMetalAreaFt2(
  cuts: CutListPiece[],
  perimeterIn: number,
): number {
  if (perimeterIn <= 0) return 0;
  return cuts.reduce(
    (sum, cut) =>
      sum + (perimeterIn * cut.lengthIn * cut.qtyEa) / 144,
    0,
  );
}

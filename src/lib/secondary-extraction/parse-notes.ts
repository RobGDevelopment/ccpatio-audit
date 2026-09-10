import type { CutListPiece } from "./types";

/**
 * Parse cut_list JSON trailer appended to product_bom_draft.notes
 * (same convention as approveDraftRecipe).
 */
export function parseCutListFromNotes(notes: string | null | undefined): {
  plainNotes: string | null;
  cutList: CutListPiece[];
} {
  if (!notes?.trim()) {
    return { plainNotes: null, cutList: [] };
  }

  const jsonMatch = notes.match(/\n(\{[\s\S]*"cut_list"[\s\S]*\})\s*$/);
  if (!jsonMatch) {
    return { plainNotes: notes.trim(), cutList: [] };
  }

  let cutList: CutListPiece[] = [];
  try {
    const parsed = JSON.parse(jsonMatch[1]) as {
      cut_list?: Array<Record<string, unknown>>;
    };
    if (Array.isArray(parsed.cut_list)) {
      cutList = parsed.cut_list.flatMap((row) => {
        const lengthIn = Number(row.lengthIn ?? row.length_in ?? 0);
        const qtyEa = Number(row.qtyEa ?? row.qty_ea ?? row.qty ?? 1);
        const profileRaw =
          typeof row.profileCode === "string"
            ? row.profileCode
            : typeof row.profile_code === "string"
              ? row.profile_code
              : typeof row.profile === "string"
                ? row.profile
                : undefined;
        if (!Number.isFinite(lengthIn) || lengthIn <= 0) return [];
        if (!Number.isFinite(qtyEa) || qtyEa <= 0) return [];
        const piece: CutListPiece = {
          lengthIn,
          qtyEa,
          ...(profileRaw ? { profileCode: profileRaw } : {}),
        };
        return [piece];
      });
    }
  } catch {
    return { plainNotes: notes.trim(), cutList: [] };
  }

  const plainNotes = notes
    .replace(/\n\{[\s\S]*"cut_list"[\s\S]*\}\s*$/, "")
    .trim();
  return { plainNotes: plainNotes || null, cutList };
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

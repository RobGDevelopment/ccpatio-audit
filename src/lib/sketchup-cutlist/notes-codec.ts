/**
 * Shared BOM notes codec — split/compose manager note vs cut_list JSON trailer.
 * Binding: docs/FACTORY_BOM_KATANA_UX_PLAN.md (Phase 1)
 */
import type {
  CutEndAngle,
  CutLine,
  LengthConvention,
  ProfileCode,
} from "./types";
import { formatCutNote } from "./long-point";

/** Trailing `{"cut_list":[...]}` appended by CAD / SketchUp instantiate writers. */
export const CUT_LIST_TRAILER_RE = /\n(\{[\s\S]*"cut_list"[\s\S]*\})\s*$/;

export type BomNotesParts = {
  /** Human-only text; never includes the JSON trailer. */
  managerNote: string;
  cutList: CutLine[];
};

function asEndAngle(value: unknown): CutEndAngle {
  if (value === 45 || value === "45") return 45;
  if (value === 90 || value === "90") return 90;
  if (value == null || value === "") return null;
  const n = Number(value);
  if (n === 45) return 45;
  if (n === 90) return 90;
  return null;
}

function asConvention(value: unknown): LengthConvention {
  if (
    value === "long_point" ||
    value === "short_point" ||
    value === "square" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function asProfile(value: unknown): ProfileCode {
  if (
    value === "SQ2-16" ||
    value === "RT1.5x0.75-16" ||
    value === "FB0.125x1.5" ||
    value === "SQ2x1-16"
  ) {
    return value;
  }
  return "UNKNOWN";
}

export function coerceCutLine(row: Record<string, unknown>): CutLine | null {
  const lengthIn = Number(row.lengthIn ?? row.length_in ?? 0);
  const qtyEa = Number(row.qtyEa ?? row.qty_ea ?? row.qty ?? 1);
  if (!Number.isFinite(lengthIn) || lengthIn <= 0) return null;
  if (!Number.isFinite(qtyEa) || qtyEa <= 0) return null;

  const profileRaw =
    row.profileCode ?? row.profile_code ?? row.profile ?? "UNKNOWN";
  const profile = asProfile(profileRaw);
  const endA = asEndAngle(row.endA ?? row.end_a);
  const endB = asEndAngle(row.endB ?? row.end_b);
  const role =
    typeof row.role === "string"
      ? row.role
      : typeof row.drawingPartNumber === "string"
        ? row.drawingPartNumber
        : "";

  return {
    role,
    profile,
    lengthIn,
    endA,
    endB,
    qtyEa,
    lengthConvention: asConvention(row.lengthConvention ?? row.length_convention),
    sourceName: typeof row.sourceName === "string" ? row.sourceName : role,
    confidence: typeof row.confidence === "string" ? row.confidence : "stated",
    drawingPartNumber:
      typeof row.drawingPartNumber === "string"
        ? row.drawingPartNumber
        : typeof row.drawing_part_number === "string"
          ? row.drawing_part_number
          : null,
  };
}

/**
 * Split `product_bom_draft.notes` into manager text + structured cut list.
 * Corrupt / missing trailers fall back to the full string as managerNote.
 */
export function splitBomNotes(
  notes: string | null | undefined,
): BomNotesParts {
  if (!notes?.trim()) {
    return { managerNote: "", cutList: [] };
  }

  const jsonMatch = notes.match(CUT_LIST_TRAILER_RE);
  if (!jsonMatch) {
    return { managerNote: notes.trim(), cutList: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[1]!) as {
      cut_list?: Array<Record<string, unknown>>;
    };
    const cutList = Array.isArray(parsed.cut_list)
      ? parsed.cut_list.flatMap((row) => {
          const cut = coerceCutLine(row);
          return cut ? [cut] : [];
        })
      : [];
    const managerNote = notes.replace(CUT_LIST_TRAILER_RE, "").trim();
    return { managerNote, cutList };
  } catch {
    return { managerNote: notes.trim(), cutList: [] };
  }
}

/**
 * Recompose draft notes for `upsertDraftBomLine`.
 * Manager note is preserved; if empty and cuts exist, seed a chop-saw plain prefix
 * so Approve's legacy strip still leaves readable text.
 */
export function composeBomNotes(input: {
  managerNote: string;
  cutList: CutLine[];
}): string | null {
  const cuts = input.cutList.filter(
    (c) => Number.isFinite(c.qtyEa) && c.qtyEa > 0 && Number.isFinite(c.lengthIn) && c.lengthIn > 0,
  );
  const manager = input.managerNote.trim();
  const plain =
    manager ||
    (cuts.length
      ? cuts
          .map((c) =>
            formatCutNote({
              qtyEa: c.qtyEa,
              lengthIn: c.lengthIn,
              endA: c.endA,
              endB: c.endB,
              convention: c.lengthConvention,
              role: c.drawingPartNumber ?? c.role,
            }),
          )
          .join("; ")
      : "");

  if (!cuts.length) return plain || null;
  return `${plain}\n${JSON.stringify({ cut_list: cuts })}`;
}

/** Floor-facing one-liner for a cut card (display only). */
export function formatFloorCutCard(cut: CutLine): string {
  const a = cut.endA ?? 90;
  const b = cut.endB ?? 90;
  const mitre = a === 45 || b === 45 ? "Mitre" : "Square";
  return `${cut.qtyEa} pcs | ${cut.lengthIn.toFixed(1)} in | ${a}°/${b}° ${mitre}`;
}

/**
 * Katana tablet ingredient note (Phase 3 uses at Approve; available early for UI preview).
 */
export function formatKatanaIngredientNote(cuts: CutLine[]): string {
  return cuts
    .filter((c) => c.qtyEa > 0 && c.lengthIn > 0)
    .map((c) => {
      const a = c.endA ?? 90;
      const b = c.endB ?? 90;
      const angleLabel =
        a === 90 && b === 90 ? "square" : `${a}°/${b}° mitre`;
      return `${c.qtyEa} pcs @ ${c.lengthIn.toFixed(1)} in · ${angleLabel}`;
    })
    .join(" · ");
}

export function endsLabel(endA: CutEndAngle, endB: CutEndAngle): string {
  const a = endA ?? 90;
  const b = endB ?? 90;
  return `${a}°/${b}°`;
}

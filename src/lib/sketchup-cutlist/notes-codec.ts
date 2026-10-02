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
import { formatDrawingPartNumber } from "./parse-component-name";

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

/** Coerce jsonb column / unknown arrays into CutLine[]. */
export function coerceCutListColumn(raw: unknown): CutLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const cut = coerceCutLine(row as Record<string, unknown>);
    return cut ? [cut] : [];
  });
}

/**
 * Resolve draft cuts: prefer cut_list column; fall back to notes trailer (legacy).
 * Manager note is always the trailer-stripped notes text.
 */
export function resolveDraftCutsAndNote(input: {
  notes: string | null | undefined;
  cutList?: unknown;
}): BomNotesParts {
  const fromNotes = splitBomNotes(input.notes);
  const fromCol = coerceCutListColumn(input.cutList);
  return {
    managerNote: fromNotes.managerNote,
    cutList: fromCol.length > 0 ? fromCol : fromNotes.cutList,
  };
}

/** Live/Katana ingredient notes: manager text, else tablet format from cuts, else "". */
export function resolveKatanaIngredientNotes(input: {
  notes: string | null | undefined;
  cutList?: unknown;
}): string {
  const { managerNote, cutList } = resolveDraftCutsAndNote({
    notes: input.notes,
    cutList: input.cutList,
  });
  if (managerNote.trim()) return managerNote.trim();
  if (cutList.length > 0) return formatKatanaIngredientNote(cutList);
  return "";
}

const PROFILE_FROM_TEXT: Array<{ needle: RegExp; profile: ProfileCode }> = [
  { needle: /FB0\.125x1\.5|FLAT\s*BAR|HR\s*FLAT/i, profile: "FB0.125x1.5" },
  { needle: /RT1\.5x0\.75-16|1\.5\s*[xX×]\s*\.?75/i, profile: "RT1.5x0.75-16" },
  { needle: /SQ2x1-16|2\s*[xX×]\s*1\b/i, profile: "SQ2x1-16" },
  { needle: /SQ2-16|2\s*[xX×]\s*2/i, profile: "SQ2-16" },
];

function profileFromFreeText(text: string): ProfileCode {
  for (const row of PROFILE_FROM_TEXT) {
    if (row.needle.test(text)) return row.profile;
  }
  return "UNKNOWN";
}

function conventionFromTag(tag: string | undefined): LengthConvention {
  const t = tag?.trim().toUpperCase();
  if (t === "LP" || t === "LONG_POINT") return "long_point";
  if (t === "SP" || t === "SHORT_POINT") return "short_point";
  if (t === "?" || t === "UNKNOWN") return "unknown";
  return "square";
}

function drawingFromFreeText(text: string): string | null {
  const match = text.match(
    /CUT-(SQ2-16|RT1\.5x0\.75-16|FB0\.125x1\.5|SQ2x1-16)-[\d.]+-\d{4}C?/i,
  );
  return match?.[0] ?? null;
}

function buildConvertedCut(input: {
  qtyEa: number;
  lengthIn: number;
  endA: CutEndAngle;
  endB: CutEndAngle;
  convention?: LengthConvention;
  source: string;
}): CutLine {
  const detected = profileFromFreeText(input.source);
  const profile: ProfileCode = detected === "UNKNOWN" ? "SQ2-16" : detected;
  const drawing =
    drawingFromFreeText(input.source) ??
    formatDrawingPartNumber({
      profile,
      lengthIn: input.lengthIn,
      endA: input.endA,
      endB: input.endB,
    });
  const squareEnds =
    (input.endA ?? 90) === 90 && (input.endB ?? 90) === 90;
  return {
    role: drawing ?? "",
    profile,
    lengthIn: input.lengthIn,
    endA: input.endA,
    endB: input.endB,
    qtyEa: input.qtyEa,
    lengthConvention:
      input.convention ?? (squareEnds ? "square" : "long_point"),
    sourceName: input.source.trim(),
    confidence: "inferred",
    drawingPartNumber: drawing,
  };
}

type Span = { start: number; end: number; cut: CutLine };

/**
 * Convert legacy chop-saw free text into structured Cut Cards.
 * Remainder is leftover human text that is not a cut descriptor.
 */
export function parseFreeTextCutCards(note: string | null | undefined): {
  cutList: CutLine[];
  remainder: string;
} {
  if (!note?.trim()) {
    return { cutList: [], remainder: "" };
  }

  const source = note.trim();
  const spans: Span[] = [];

  const push = (
    match: RegExpExecArray,
    cut: CutLine,
  ) => {
    spans.push({ start: match.index, end: match.index + match[0].length, cut });
  };

  const katanaRe =
    /(\d+)\s*pcs\s*@\s*(\d+(?:\.\d+)?)\s*in(?:ches?)?\s*·\s*(square|(\d+)°\s*\/\s*(\d+)°\s*mitre)/gi;
  for (const match of source.matchAll(katanaRe)) {
    const qtyEa = Number(match[1]);
    const lengthIn = Number(match[2]);
    const square = match[3]?.toLowerCase() === "square";
    const endA = (square ? 90 : Number(match[4]) === 45 ? 45 : 90) as CutEndAngle;
    const endB = (square ? 90 : Number(match[5]) === 45 ? 45 : 90) as CutEndAngle;
    push(
      match,
      buildConvertedCut({
        qtyEa,
        lengthIn,
        endA,
        endB,
        convention: square ? "square" : "long_point",
        source: match[0],
      }),
    );
  }

  const floorRe =
    /(\d+)\s*pcs\s*\|\s*(\d+(?:\.\d+)?)\s*in\s*\|\s*(\d+)°\s*\/\s*(\d+)°/gi;
  for (const match of source.matchAll(floorRe)) {
    push(
      match,
      buildConvertedCut({
        qtyEa: Number(match[1]),
        lengthIn: Number(match[2]),
        endA: Number(match[3]) === 45 ? 45 : 90,
        endB: Number(match[4]) === 45 ? 45 : 90,
        source: match[0],
      }),
    );
  }

  const cutNoteRe =
    /(\d+)\s*ea\s+(\d+(?:\.\d+)?)\s*in\s+(45|90)\s*\/\s*(45|90)C?(?:\s+(LP|SP|\?))?(?:\s+(\S+))?/gi;
  for (const match of source.matchAll(cutNoteRe)) {
    const endA = match[3] === "45" ? 45 : 90;
    const endB = match[4] === "45" ? 45 : 90;
    push(
      match,
      buildConvertedCut({
        qtyEa: Number(match[1]),
        lengthIn: Number(match[2]),
        endA,
        endB,
        convention: conventionFromTag(match[5]),
        source: match[0],
      }),
    );
  }

  const casualRe =
    /Cut\s+(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*inches?\s+(45|90)\s*\/\s*(45|90)/gi;
  for (const match of source.matchAll(casualRe)) {
    push(
      match,
      buildConvertedCut({
        qtyEa: Number(match[1]),
        lengthIn: Number(match[2]),
        endA: match[3] === "45" ? 45 : 90,
        endB: match[4] === "45" ? 45 : 90,
        source: match[0],
      }),
    );
  }

  spans.sort((a, b) => a.start - b.start);
  const used: Span[] = [];
  for (const span of spans) {
    if (used.some((u) => span.start < u.end && span.end > u.start)) continue;
    used.push(span);
  }

  let remainder = source;
  for (const span of [...used].sort((a, b) => b.start - a.start)) {
    remainder = remainder.slice(0, span.start) + remainder.slice(span.end);
  }
  remainder = remainder
    .replace(/[;|]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[·\s]+|[·\s]+$/g, "")
    .trim();

  return { cutList: used.map((s) => s.cut), remainder };
}

/** True when a manager note still looks like a chop-saw list with no cards. */
export function noteLooksLikeLegacyCutList(note: string | null | undefined): boolean {
  return parseFreeTextCutCards(note).cutList.length > 0;
}

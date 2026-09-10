/**
 * Parse SketchUp component definition names like:
 *   BRAVADA SEAT FRAME 2X2 16 GA 34" 45 45
 *   BRAVADA FLAT BAR HR FLAT 1/8" 30" 90 90
 *   BRAVADA MIDDLE FRAME 1.5X.75 16 GA 30"
 */
import type {
  CutEndAngle,
  ParsedComponentName,
  ProfileCode,
} from "./types";

const GA_RE = /(\d+)\s*GA\b/i;
const LEN_RE = /(\d+(?:\.\d+)?)\s*["″]/;
const ENDS_RE = /\b(45|90)\s+(45|90)\b/;
const SQ2_RE = /\b2\s*[xX×]\s*2\b/;
const SQ21_RE = /\b2\s*[xX×]\s*1\b/;
const RT15_RE = /\b1\.5\s*[xX×]\s*\.?75\b|\b1\.5\s*[xX×]\s*3\/4\b|\b1\s*1\/2\s*[xX×]\s*3\/4\b/i;
const FLAT_RE = /\bFLAT\s*BAR|\bHR\s*FLAT|\b1\/8\b/i;
const ASM_RE =
  /\b(CLUB\s+CHAIR\s+)?(SEAT|ARM|BACK|FRAME)\b(?!.*\d+\s*["″])/i;

function parseEnd(raw: string | undefined): CutEndAngle {
  if (raw === "45") return 45;
  if (raw === "90") return 90;
  return null;
}

export function looksLikeCutListName(name: string): boolean {
  return (
    LEN_RE.test(name) ||
    SQ2_RE.test(name) ||
    /\b16\s*GA\b/i.test(name) ||
    FLAT_RE.test(name) ||
    /\b(45|90)\b/.test(name)
  );
}

export function resolveProfile(name: string): {
  profile: ProfileCode;
  profileWidthIn: number;
} {
  if (FLAT_RE.test(name)) {
    return { profile: "FB0.125x1.5", profileWidthIn: 1.5 };
  }
  if (RT15_RE.test(name)) {
    return { profile: "RT1.5x0.75-16", profileWidthIn: 1.5 };
  }
  if (SQ21_RE.test(name)) {
    return { profile: "SQ2x1-16", profileWidthIn: 2 };
  }
  if (SQ2_RE.test(name)) {
    return { profile: "SQ2-16", profileWidthIn: 2 };
  }
  return { profile: "UNKNOWN", profileWidthIn: 2 };
}

export function parseComponentName(rawName: string): ParsedComponentName {
  const name = rawName.trim();
  const { profile, profileWidthIn } = resolveProfile(name);
  const gaugeMatch = name.match(GA_RE);
  const endsMatch = name.match(ENDS_RE);
  const lenMatches = [...name.matchAll(new RegExp(LEN_RE, "g"))];

  // Prefer the length token that is not the flat-bar thickness "1/8""
  let nameLengthIn: number | null = null;
  for (const m of lenMatches) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    if (n <= 0.25) continue; // skip 1/8"
    nameLengthIn = n;
  }

  let endA: CutEndAngle = null;
  let endB: CutEndAngle = null;
  if (endsMatch) {
    endA = parseEnd(endsMatch[1]);
    endB = parseEnd(endsMatch[2]);
  } else if (nameLengthIn != null && SQ2_RE.test(name)) {
    // Legs often omit 90 90
    endA = 90;
    endB = 90;
  }

  const asm = name.match(ASM_RE);
  const roleHint = asm?.[2]?.toUpperCase() ?? name.split(/\s+/).slice(0, 4).join(" ");

  return {
    rawName: name,
    roleHint,
    profile,
    profileWidthIn,
    gauge: gaugeMatch ? `${gaugeMatch[1]} GA` : null,
    nameLengthIn,
    endA,
    endB,
    looksLikeCut: looksLikeCutListName(name),
  };
}

export function profileToRmSku(profile: ProfileCode): string {
  switch (profile) {
    case "SQ2-16":
      return "RM-MET-2X2-TUBING";
    case "SQ2x1-16":
      return "RM-MET-2X1-TUBING";
    case "RT1.5x0.75-16":
      return "RM-MET-15X075-TUBING";
    case "FB0.125x1.5":
      return "RM-MET-FLATBAR";
    default:
      return "RM-MET-2X2-TUBING";
  }
}

export function formatDrawingPartNumber(input: {
  profile: ProfileCode;
  lengthIn: number;
  endA: CutEndAngle;
  endB: CutEndAngle;
}): string | null {
  if (input.profile === "UNKNOWN" || input.lengthIn <= 0) return null;
  const a = input.endA ?? 90;
  const b = input.endB ?? 90;
  const closed = a === 45 && b === 45 ? "C" : "";
  const len = input.lengthIn.toFixed(1);
  return `CUT-${input.profile}-${len}-${a}${b}${closed}`;
}

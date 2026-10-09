export type ProfileType = "SQ2-16" | "SQ2x1-16" | "RT1.5x0.75-16" | "FB0.125x1.5";
export type ConfidenceType = "stated" | "inferred" | "inferred_override";
export type LengthSourceType = "aabb" | "stated";

export interface ComponentHygieneResult {
  isStructural: boolean;
  isValid: boolean;
  reason?: string;
  name: string;
  role?: string;
  material?: string;
  profile?: ProfileType;
  lengthIn?: number;
  statedLengthIn?: number | null;
  lengthSource?: LengthSourceType;
  confidence?: ConfidenceType;
  endA?: "45" | "90" | null;
  endB?: "45" | "90" | null;
  lengthConvention?: "long_point" | "square";
}

const ROLES = new Set(["FRM", "LEG", "ARM", "SEAT", "BACK", "TOP", "RAIL"]);
const MATERIALS = new Set(["ALUM", "STL", "DEK", "FAB", "HW"]);
const PROFILES: Record<string, ProfileType> = {
  "2X2": "SQ2-16",
  "2X1": "SQ2x1-16",
  "15X075": "RT1.5x0.75-16",
  "FB125": "FB0.125x1.5",
};

export function isStructuralNode(name: string): boolean {
  const upper = name.trim().toUpperCase();
  const parts = upper.split("-");
  if (parts.length > 0 && ROLES.has(parts[0])) return true;
  for (const part of parts) {
    if (PROFILES[part]) return true;
  }
  return false;
}

export function evaluateComponentHygiene(
  name: string,
  aabbLongAxisIn: number
): ComponentHygieneResult {
  const upper = name.trim().toUpperCase();
  if (!isStructuralNode(upper)) {
    return { isStructural: false, isValid: true, name };
  }

  const parts = upper.split("-");
  
  if (parts.length < 3) {
    return {
      isStructural: true,
      isValid: false,
      reason: "Missing required ROLE-MATERIAL-PROFILE tokens",
      name,
    };
  }

  const role = parts[0];
  const material = parts[1];
  const profileToken = parts[2];

  if (!ROLES.has(role)) {
    return { isStructural: true, isValid: false, reason: `Invalid role: ${role}`, name };
  }
  if (!MATERIALS.has(material)) {
    return { isStructural: true, isValid: false, reason: `Invalid material: ${material}`, name };
  }
  if (!PROFILES[profileToken]) {
    return { isStructural: true, isValid: false, reason: `Invalid profile: ${profileToken}`, name };
  }

  let statedLengthIn: number | null = null;
  let endA: "45" | "90" | null = null;
  let endB: "45" | "90" | null = null;

  if (parts.length === 5 || parts.length > 6) {
    return {
      isStructural: true,
      isValid: false,
      reason: "Name must match ROLE-MATERIAL-PROFILE[-LENGTH][-ENDA-ENDB]",
      name,
    };
  }

  if (parts.length >= 4) {
    const lenStr = parts[3];
    if (!/^\d+(\.\d+)?$/.test(lenStr)) {
      return { isStructural: true, isValid: false, reason: `Invalid length token: ${lenStr}`, name };
    }
    statedLengthIn = Number(lenStr);
  }

  if (parts.length === 6) {
    const ea = parts[4];
    const eb = parts[5];
    if (ea !== "45" && ea !== "90") {
      return { isStructural: true, isValid: false, reason: `Invalid end token: ${ea}`, name };
    }
    if (eb !== "45" && eb !== "90") {
      return { isStructural: true, isValid: false, reason: `Invalid end token: ${eb}`, name };
    }
    endA = ea;
    endB = eb;
  }

  let cutLengthIn: number = aabbLongAxisIn;
  let lengthSource: LengthSourceType = "aabb";
  let confidence: ConfidenceType = "inferred";

  if (statedLengthIn !== null) {
    const diff = Math.abs(statedLengthIn - aabbLongAxisIn);
    if (diff <= 0.25) {
      cutLengthIn = statedLengthIn;
      lengthSource = "stated";
      confidence = "stated";
    } else {
      cutLengthIn = aabbLongAxisIn;
      lengthSource = "aabb";
      confidence = "inferred_override";
    }
  }

  const lengthConvention = (endA === "45" || endB === "45") ? "long_point" : "square";
  if (!endA) endA = "90";
  if (!endB) endB = "90";

  return {
    isStructural: true,
    isValid: true,
    name,
    role,
    material,
    profile: PROFILES[profileToken],
    lengthIn:
      lengthSource === "stated" && statedLengthIn !== null
        ? statedLengthIn
        : Number(cutLengthIn.toFixed(2)),
    statedLengthIn,
    lengthSource,
    confidence,
    endA,
    endB,
    lengthConvention,
  };
}

export function formatGeomHygieneMessage(failures: { name: string; reason: string }[]): string {
  if (
    failures.length === 1 &&
    failures[0]?.name === "File" &&
    failures[0]?.reason === "Zero structural nodes"
  ) {
    return "No structural components were found. Group each frame member and rename it ROLE-MATERIAL-PROFILE (example: FRM-ALUM-2X2). Decorative meshes stay outside that grammar and are ignored.";
  }

  const seen = new Map<string, number>();
  const labeled = failures.map((failure) => {
    const raw = failure.name.trim() ? failure.name.trim() : "(unnamed node)";
    const n = (seen.get(raw) ?? 0) + 1;
    seen.set(raw, n);
    return { name: n === 1 ? raw : `${raw} #${n}`, reason: failure.reason };
  });

  const groups = new Map<string, string[]>();
  for (const row of labeled) {
    const names = groups.get(row.reason) ?? [];
    names.push(row.name);
    groups.set(row.reason, names);
  }

  const bullets: string[] = [];
  let omitted = 0;
  for (const [reason, names] of groups) {
    for (const name of names) {
      if (bullets.length >= 12) {
        omitted += 1;
        continue;
      }
      bullets.push(`- ${name} — ${reason}`);
    }
  }

  const intro =
    "The following components failed the lengthless naming standard. Please group these meshes and rename using the ROLE-MATERIAL-PROFILE format (example: FRM-ALUM-2X2). Do not put inches in the name. The parser owns the cut length.";
  const tail =
    omitted > 0 ? `and ${omitted} more. The geometry snapshot has the full list.` : "";
  let message = [intro, ...bullets, tail].filter(Boolean).join("\n");
  while (message.length > 2000 && bullets.length > 0) {
    bullets.pop();
    message = [intro, ...bullets, tail].filter(Boolean).join("\n");
  }
  return message;
}

/**
 * Finished-good SKU generator — canonical TypeScript engine.
 * Format: FIN-{colCode}-{catCode}-{size}
 *
 * Category codes use modular [MODIFIER]-[NOUN] tokens (e.g. SWV-CHA, COF-TAB).
 * Compound rules are ordered most-specific first.
 */

const COLLECTION_CODES: ReadonlyArray<[string, string]> = [
  ["BRAVADA", "BRV"],
  ["BROOKLYN", "BRK"],
  ["OCEAN", "OCN"],
  ["MILAN", "MLN"],
  ["MARINA", "MLN"],
  ["TENJAM", "TJM"],
  ["TAYLOR", "TAY"],
  ["WATERFALL", "WFT"],
  ["FLEXY", "ESY"],
  ["EASY", "ESY"],
  ["FLY", "FLY"],
  ["DAISY", "DAI"],
  ["CUSTOM", "CUS"],
  ["STANDARD", "STA"],
  ["TRIANGLE", "TRI"],
  ["KING", "KIN"],
  ["LED", "LED"],
  ["FLEX", "FLE"],
  ["CANOPY", "CAN"],
  ["OCCASIONAL", "OCC"],
  ["CABANA", "CAB"],
];

/** Most-specific product-type rules first (modifier + noun). */
const CATEGORY_RULES: ReadonlyArray<[RegExp, string]> = [
  [/UMBRELLA/i, "UMB"],
  [/SWIVEL\s+BARSTOOL|BARSTOOL[^)]*SWIVEL/i, "SWV-BST"],
  [/SWIVEL\s+CHAIR|CHAIR[^)]*SWIVEL/i, "SWV-CHA"],
  [/TRANSITIONAL\s+DOUBLE\s+CHAISE/i, "TRA-DOU-CHS"],
  [/TRANSITIONAL\s+SINGLE\s+CHAISE/i, "TRA-SGL-CHS"],
  [/DOUBLE\s+CHAISE/i, "DOU-CHS"],
  [/SINGLE\s+CHAISE(?:\s+LOUNGE)?/i, "SGL-CHS"],
  [/OVERSIZED\s+CHAISE/i, "OVS-CHS"],
  [/CORNER\s+SOFA/i, "COR-SOF"],
  [/CORNER\s+CHAISE/i, "COR-CHS"],
  [/ARMLESS\s+SOFA/i, "ARM-SOF"],
  [/ARMLESS\s+LOVESEAT/i, "ARM-LOV"],
  [/MINI\s+LOVESEAT/i, "MIN-LOV"],
  [/LOVESEAT/i, "LOV-SOF"],
  [/\bSOFA\b/i, "SOF"],
  [/DAYBED/i, "DYB"],
  [/CLUB\s+CHAIR/i, "CLB-CHA"],
  [/HALF\s+BACK\s+BARSTOOL|FLY\s+LEG\s+BARSTOOL/i, "FLY-BST"],
  [/BARSTOOL/i, "BST"],
  [/DINING\s+BENCH/i, "DIN-BCH"],
  [/\bBENCH\b/i, "BCH"],
  [/OTTOMAN/i, "OTT"],
  [/COFFEE\s+TABLE/i, "COF-TAB"],
  [/FIRE\s+PIT\s+(?:DINING\s+)?TABLE/i, "FIR-TAB"],
  [/SIDE\s+TABLE/i, "SID-TAB"],
  [/TABLE\s*\(DINING\s+HEIGHT\)|DINING\s+TABLE/i, "DIN-TAB"],
  [
    /ROUND\s+TABLE.*\(BAR\s+HEIGHT\)|TABLE\s*\(BAR\s+HEIGHT\).*ROUND|ROUND\s+(?:SIDE\s+)?TABLE/i,
    "RND-TAB",
  ],
  [/TABLE\s*\(BAR\s+HEIGHT\)|BAR\s+HEIGHT\s*\)\s*\d/i, "BAR-TAB"],
  [/TABLE\s*\(COUNTER\s+HEIGHT\)/i, "CNT-TAB"],
  [
    /CHAIR\s*\(DINING\s+HEIGHT\)|CHAIR[^)]*DINING\s+HEIGHT|DINING\s+HEIGHT[^)]*CHAIR/i,
    "DIN-CHA",
  ],
  [/SWING(?:\s+FRAME\s+ONLY)?/i, "SWG"],
  [/CHAISE/i, "CHS"],
  [/\bTABLE\b/i, "TAB"],
  [/\bCHAIR\b/i, "CHA"],
];

const DIMENSION_TOKEN = /\b\d{2,3}\b/g;

function normalizeText(value: string): string {
  return value.trim().toUpperCase();
}

function stripDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function resolveColCode(collection: string, nameOrMemo: string): string {
  const haystack = normalizeText(`${collection} ${nameOrMemo}`);

  for (const [needle, code] of COLLECTION_CODES) {
    if (haystack.includes(needle)) {
      return code;
    }
  }

  const firstToken = normalizeText(nameOrMemo).split(/\s+/)[0] ?? "";
  for (const [needle, code] of COLLECTION_CODES) {
    if (firstToken === needle || firstToken.startsWith(needle.slice(0, 3))) {
      return code;
    }
  }

  return "MIS";
}

export function resolveCatCode(nameOrMemo: string): string {
  const text = nameOrMemo.trim();
  if (!text) {
    return "MIS";
  }

  for (const [pattern, code] of CATEGORY_RULES) {
    if (pattern.test(text)) {
      return code;
    }
  }

  return "MIS";
}

function healDimensions(
  nameOrMemo: string,
  length: string,
  depth: string,
): { length: string; depth: string } {
  let len = stripDigits(length);
  let dep = stripDigits(depth);

  if (!len || !dep) {
    const tokens = nameOrMemo.match(DIMENSION_TOKEN) ?? [];
    if (!len && tokens[0]) {
      len = tokens[0];
    }
    if (!dep) {
      const second = tokens.find((token, index) => index > 0 && token !== len);
      if (second) {
        dep = second;
      }
    }
  }

  return { length: len, depth: dep };
}

function formatSize(length: string, depth: string): string {
  if (length && depth) {
    return `${length}X${depth}`;
  }
  if (length) {
    return length;
  }
  if (depth) {
    return depth;
  }
  return "";
}

/**
 * Build a canonical finished-good Global E2E SKU from factory naming inputs.
 */
export function generateFinishedGoodSku(
  nameOrMemo: string,
  collection: string,
  length: string,
  depth: string,
): string {
  const colCode = resolveColCode(collection, nameOrMemo);
  const catCode = resolveCatCode(nameOrMemo);
  const healed = healDimensions(nameOrMemo, length, depth);
  const size = formatSize(healed.length, healed.depth);

  if (size) {
    return `FIN-${colCode}-${catCode}-${size}`;
  }
  return `FIN-${colCode}-${catCode}`;
}

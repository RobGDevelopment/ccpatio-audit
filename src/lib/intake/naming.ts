/**
 * Pure, client-safe naming and code derivation helpers.
 */

const SUFFIX_TOKENS = new Set([
  "JR",
  "SR",
  "II",
  "III",
  "IV",
  "LLC",
  "INC",
  "LTD",
  "TRUST",
  "FAMILY",
]);

const STOPWORDS = new Set(["THE", "A", "AN", "WITH", "FOR", "OF"]);

function normalizeString(str: string): string {
  return str
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Derives a 3-16 character alphanumeric client code from contact or opportunity name.
 */
export function deriveClientCode(contactName?: string | null, opportunityName?: string | null): string {
  const normContact = normalizeString(contactName || "");
  const normOpp = normalizeString(opportunityName || "");

  const source = normContact || normOpp;
  if (!source) {
    throw new Error("Cannot derive client code: contact and project name are both empty.");
  }

  // Strip apostrophes first so O'Connor -> OConnor
  const dequoted = source.replace(/['’]/g, "");

  // Tokenize
  const rawTokens = dequoted
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.toUpperCase())
    .filter(Boolean);

  // Drop suffix tokens from the end
  while (rawTokens.length > 1 && SUFFIX_TOKENS.has(rawTokens[rawTokens.length - 1]!)) {
    rawTokens.pop();
  }

  const token = rawTokens[rawTokens.length - 1] || "";
  const cleaned = token.replace(/[^A-Z0-9]/g, "").substring(0, 16);

  if (!cleaned) {
    throw new Error("Derived client code is empty.");
  }

  return cleaned;
}

/**
 * Derives a 3-24 character token-boundary item code from piece name.
 * e.g. "Malibu 3-Seat Sectional" -> "MALIBU-3-SEAT-SECTIONAL"
 */
export function deriveItemCode(pieceName: string): string {
  const norm = normalizeString(pieceName);
  const rawTokens = norm
    .replace(/[^A-Za-z0-9]/g, " ")
    .split(/\s+/)
    .map((t) => t.toUpperCase())
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t));

  if (rawTokens.length === 0) {
    throw new Error("Item name does not contain any valid words.");
  }

  let result = "";
  for (const token of rawTokens) {
    const candidate = result ? `${result}-${token}` : token;
    if (candidate.length <= 24) {
      result = candidate;
    } else {
      // If result is empty, even the first token exceeds 24
      if (!result) {
        result = token.substring(0, 24);
      }
      break;
    }
  }

  // Ensure minimum 3 characters
  if (result.length < 3) {
    result = result.padEnd(3, "0");
  }

  return result;
}

/**
 * Builds standard client item code: JOB-{CLIENT}-{ITEM}[-V{n}]
 */
export function buildClientSku(clientCode: string, itemCode: string, variantIndex?: number): string {
  const base = `JOB-${clientCode}-${itemCode}`;
  if (variantIndex && variantIndex >= 2) {
    return `${base}-V${variantIndex}`.substring(0, 64);
  }
  return base.substring(0, 64);
}

/**
 * Computes next free variant index for collision avoidance.
 * Exact match comparison only; does NOT use LIKE 'base%'.
 */
export function nextVariantIndex(existingSkus: string[], baseSku: string): number {
  const exactExists = existingSkus.includes(baseSku);
  if (!exactExists) {
    return 1;
  }

  let maxVariant = 1;

  for (const sku of existingSkus) {
    if (sku === baseSku) {
      if (maxVariant < 1) maxVariant = 1;
      continue;
    }

    // Modern -V{n}
    const vMatch = sku.match(new RegExp(`^${baseSku}-V(\\d{1,2})$`));
    if (vMatch) {
      const idx = parseInt(vMatch[1]!, 10);
      if (idx > maxVariant) maxVariant = idx;
      continue;
    }

    // Legacy -{02}
    const legacyMatch = sku.match(new RegExp(`^${baseSku}-(\\d{2})$`));
    if (legacyMatch) {
      const idx = parseInt(legacyMatch[1]!, 10);
      if (idx > maxVariant) maxVariant = idx;
    }
  }

  return maxVariant + 1;
}

/**
 * Suggests piece name and dimensions from dropped filename.
 * e.g. "Malibu_Sofa_96x38.glb" -> { pieceName: "Malibu Sofa", length: 96, depth: 38 }
 */
export function suggestFromFilename(filename: string): {
  pieceName?: string;
  length?: number;
  depth?: number;
  collectionAlias?: string;
} {
  const nameWithoutExt = filename.replace(/\.[a-zA-Z0-9]+$/, "");
  const parts = nameWithoutExt.split(/[_\-\s]+/);

  let length: number | undefined;
  let depth: number | undefined;
  const nameParts: string[] = [];

  for (const part of parts) {
    const dimMatch = part.match(/^(\d{2,3})[xX](\d{2,3})$/);
    if (dimMatch) {
      length = parseInt(dimMatch[1]!, 10);
      depth = parseInt(dimMatch[2]!, 10);
      continue;
    }
    if (/^\d{2,3}$/.test(part) && !length) {
      length = parseInt(part, 10);
      continue;
    }
    nameParts.push(part);
  }

  const pieceName = nameParts.length > 0 ? nameParts.join(" ") : undefined;

  return {
    pieceName,
    length,
    depth,
  };
}

/**
 * Rounds fractional inches to whole inches for code generation only.
 */
export function roundInchesForCode(value: number): number {
  return Math.round(value);
}

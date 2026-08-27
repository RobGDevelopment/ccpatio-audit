/**
 * Python-compatible finished-good SKU helpers (generate_sku_dictionary.py).
 * Used to match Website Products HTML memos to seeded sku_mappings rows.
 */

export function tokenize(text: string): string[] {
  return text.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
}

export function normalizeCatalogText(text: string): string {
  return text
    .replace(/[""″'']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** Memo like `BRAVADA SWIVEL CHAIR 34" x 34" x 31" BH` → `BRAVADA SWIVEL CHAIR 34`. */
export function extractProductNameFromMemo(memo: string): string {
  const withoutDims = memo.split(/["″]\s*x\s+/i)[0] ?? memo;
  return normalizeCatalogText(withoutDims);
}

/**
 * BRAVADA SWIVEL CHAIR 34 → FIN-BRA-SWI-CHA-34
 * Words truncate to `width`; pure numeric tokens (sizes) stay whole.
 */
export function finishedGoodSku(productName: string, width: number): string {
  const parts: string[] = [];
  for (const tok of tokenize(productName)) {
    parts.push(/^\d+$/.test(tok) ? tok : tok.slice(0, width));
  }
  if (parts.length === 0) {
    return "FIN-UNK";
  }
  return `FIN-${parts.join("-")}`;
}

export function finishedGoodSkuCandidates(productName: string): string[] {
  const tokens = tokenize(productName);
  const wordLengths = tokens
    .filter((tok) => !/^\d+$/.test(tok))
    .map((tok) => tok.length);
  const maxWidth = Math.max(3, ...wordLengths, 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let width = 3; width <= maxWidth; width++) {
    const sku = finishedGoodSku(productName, width);
    if (!seen.has(sku)) {
      seen.add(sku);
      out.push(sku);
    }
  }
  return out;
}

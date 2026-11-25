/**
 * Resolve simple SKUs and grouped parent SKUs (including -LS / -RS pairs)
 * for the GHL Edit Details drawer / portal product API.
 */

export type GroupedSkuResolution = {
  /** Canonical parent / lookup SKU (facing suffix stripped when applicable). */
  parentSku: string;
  /** Exact identity that was requested. */
  requestedSku: string;
  /** Child facing SKUs when this is a left/right pair. */
  childSkus: string[];
  /** True when requested identity ends with -LS or -RS. */
  isFacingChild: boolean;
};

const FACING_RE = /-(LS|RS)$/i;

/** Strip -LS / -RS facing suffix to recover the grouped parent SKU. */
export function stripFacingSuffix(sku: string): string {
  return sku.trim().toUpperCase().replace(FACING_RE, "");
}

export function facingSuffix(sku: string): "LS" | "RS" | null {
  const m = FACING_RE.exec(sku.trim().toUpperCase());
  if (!m) return null;
  return m[1]!.toUpperCase() as "LS" | "RS";
}

/**
 * Build parent + child SKU candidates for DB lookup.
 * Always includes the raw SKU, the parent (suffix-stripped), and both -LS/-RS children.
 */
export function resolveGroupedSkuCandidates(rawSku: string): GroupedSkuResolution {
  const requestedSku = rawSku.trim().toUpperCase();
  const suffix = facingSuffix(requestedSku);
  const parentSku = stripFacingSuffix(requestedSku);
  const childSkus =
    parentSku.length > 0
      ? [`${parentSku}-LS`, `${parentSku}-RS`]
      : [];
  return {
    parentSku,
    requestedSku,
    childSkus,
    isFacingChild: suffix !== null,
  };
}

/**
 * Prefer an exact match, then parent row, then either facing child.
 * `rows` should be queried with `IN (requested, parent, parent-LS, parent-RS)`.
 */
export function pickGroupedSkuRow<T extends { globalSku: string }>(
  rows: T[],
  rawSku: string,
): { row: T | null; resolution: GroupedSkuResolution } {
  const resolution = resolveGroupedSkuCandidates(rawSku);
  const bySku = new Map(rows.map((r) => [r.globalSku.trim().toUpperCase(), r]));
  const order = [
    resolution.requestedSku,
    resolution.parentSku,
    ...resolution.childSkus,
  ];
  for (const key of order) {
    const hit = bySku.get(key);
    if (hit) return { row: hit, resolution };
  }
  return { row: null, resolution };
}

/** True when two SKUs share the same parent after facing-strip. */
export function sameGroupedParent(a: string, b: string): boolean {
  return stripFacingSuffix(a) === stripFacingSuffix(b);
}

/**
 * Pure classifiers for the ASM- prefix realignment.
 *
 * Katana purge: empty/orphan SA-* products created in the last 24 hours
 * with zero recipe rows and zero bom_rows. No fuzzy matching.
 *
 * Hub wipe: product_bom / product_bom_draft rows stamped
 * `archetype clone from …`.
 */

export const SA_ORPHAN_PREFIX = "SA-";
export const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ARCHETYPE_CLONE_NOTE_PREFIX = "archetype clone from ";
export const ARCHETYPE_CLONE_SOURCE_FILE = "archetype_clone";

export function isSaPrefixSku(sku: string): boolean {
  return sku.trim().toUpperCase().startsWith(SA_ORPHAN_PREFIX);
}

export function isWithinLast24Hours(
  createdAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (createdAt == null || createdAt === "") return false;
  const t =
    createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  if (!Number.isFinite(t)) return false;
  const ageMs = now.getTime() - t;
  return ageMs >= 0 && ageMs <= ORPHAN_MAX_AGE_MS;
}

export function isEmptyRecipe(childCount: number): boolean {
  return childCount === 0;
}

/**
 * Delete-allowed gate for Katana SA-* ghosts.
 * Requires SA- prefix, created in the last 24h, and zero children on
 * BOTH /recipes and /bom_rows. Missing created_at fails closed.
 */
export function isKatanaSaOrphanCandidate(input: {
  sku: string;
  createdAt: Date | string | null | undefined;
  recipeChildCount: number;
  bomChildCount: number;
  isMaterial?: boolean;
  now?: Date;
}): boolean {
  if (input.isMaterial) return false;
  if (!isSaPrefixSku(input.sku)) return false;
  if (!isWithinLast24Hours(input.createdAt, input.now)) return false;
  return (
    isEmptyRecipe(input.recipeChildCount) && isEmptyRecipe(input.bomChildCount)
  );
}

export function isArchetypeCloneNote(notes: string | null | undefined): boolean {
  return (notes ?? "").trim().toLowerCase().startsWith(ARCHETYPE_CLONE_NOTE_PREFIX);
}

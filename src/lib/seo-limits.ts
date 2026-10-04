/** Client-safe SEO limits, slug rule and counter bands (blueprint §6.3). */
export const SEO_LIMITS = { title: 60, description: 160, slug: 80 } as const;
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type CounterBand = "empty" | "short" | "good" | "over";

/** Title: amber < 50, green 50–60, red > 60. Description: amber < 120, green 120–160, red > 160. */
export function counterBand(length: number, limit: number, goodFrom: number): CounterBand {
  if (length === 0) return "empty";
  if (length > limit) return "over";
  if (length < goodFrom) return "short";
  return "good";
}

export const TITLE_GOOD_FROM = 50;
export const DESCRIPTION_GOOD_FROM = 120;

/** Normalized slug preview: lowercase words joined by single hyphens. */
export function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Live (keystroke) normalization: same rules as normalizeSlug, but a single trailing
 * hyphen survives so an operator can type `milan-lounge` word by word. Always finish
 * with normalizeSlug (on blur / save) to get a value that passes SLUG_RE.
 */
export function typingSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "");
  return cleaned;
}

/** Lowercase, comma-free, de-duplicated tags (blueprint §6.3). */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  for (const t of raw) {
    const n = t.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
    if (n) seen.add(n);
  }
  return [...seen];
}

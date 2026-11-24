/**
 * A7 — Clover bearer token env-name alignment.
 * Payment hydration historically read `CLOVER_MERCHANT_TOKEN`; catalog fan-out
 * read `CLOVER_API_TOKEN`. Resolve either name so log dry-run never fails on drift.
 */
export function resolveCloverBearerToken(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const merchant = env.CLOVER_MERCHANT_TOKEN?.trim();
  if (merchant) return merchant;
  const api = env.CLOVER_API_TOKEN?.trim();
  if (api) return api;
  return undefined;
}

export function resolveCloverApiBase(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromBase = env.CLOVER_API_BASE?.trim().replace(/\/$/, "");
  if (fromBase) return fromBase;
  const fromUrl = env.CLOVER_API_URL?.trim().replace(/\/$/, "");
  if (fromUrl) return fromUrl;
  return "https://api.clover.com";
}

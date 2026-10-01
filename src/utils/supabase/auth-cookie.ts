import type { CookieOptions } from "@supabase/ssr";

/**
 * Supabase session cookies must travel on cross-site iframe loads
 * (GoHighLevel custom menu links). SameSite=None requires Secure.
 * Partitioned (CHIPS) scopes the cookie to the embedding top-level site.
 */
export const supabaseAuthCookieOptions = {
  path: "/",
  sameSite: "none",
  secure: true,
  partitioned: true,
} as const satisfies CookieOptions;

export function withEmbeddableAuthCookie<T extends CookieOptions>(
  options: T,
): T & CookieOptions {
  return {
    ...options,
    ...supabaseAuthCookieOptions,
  };
}

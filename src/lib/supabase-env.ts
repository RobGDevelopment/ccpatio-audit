/**
 * Resolve 2026 publishable/secret keys with fallbacks to legacy anon/service_role names.
 * Never log key values.
 */
export function getSupabaseUrl(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    undefined
  );
}

/** Browser-safe key: `sb_publishable_…` or legacy JWT anon. */
export function getSupabasePublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    undefined
  );
}

/** Server-only key: `sb_secret_…` or legacy JWT service_role. Never NEXT_PUBLIC_. */
export function getSupabaseSecretKey(): string | undefined {
  return (
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    undefined
  );
}

export function isNewSupabaseApiKey(key: string): boolean {
  return key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
}

/**
 * supabase-js still puts new-format keys on `Authorization: Bearer`, which Auth
 * rejects as "Invalid API key". Keep the key on `apikey` only.
 */
export function createSupabaseFetch(apiKey: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("apikey")) {
      headers.set("apikey", apiKey);
    }
    if (isNewSupabaseApiKey(apiKey)) {
      const auth = headers.get("Authorization");
      if (auth === `Bearer ${apiKey}` || auth === apiKey) {
        headers.delete("Authorization");
      }
    }
    return fetch(input, { ...init, headers });
  };
}

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  createSupabaseFetch,
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "@/lib/supabase-env";
import { supabaseAuthCookieOptions, withEmbeddableAuthCookie } from "@/utils/supabase/auth-cookie";

export async function createClient() {
  const cookieStore = await cookies();

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabasePublishableKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) must be defined.",
    );
  }

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookieOptions: supabaseAuthCookieOptions,
      global: {
        fetch: createSupabaseFetch(supabaseAnonKey),
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, withEmbeddableAuthCookie(options)),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  );
}

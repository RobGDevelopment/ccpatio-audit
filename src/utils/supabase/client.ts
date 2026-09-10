import { createBrowserClient } from "@supabase/ssr";
import {
  createSupabaseFetch,
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "@/lib/supabase-env";

export function createClient() {
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabasePublishableKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) must be defined.",
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    global: {
      fetch: createSupabaseFetch(supabaseAnonKey),
    },
  });
}

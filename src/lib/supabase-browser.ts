"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseFetch,
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "@/lib/supabase-env";

let browserClient: SupabaseClient | null = null;

/**
 * Browser Supabase client for Realtime subscriptions.
 * Requires NEXT_PUBLIC_SUPABASE_URL + publishable (or legacy anon) key.
 * Returns null when unset so the dictionary still works (delta poll fallback).
 */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (browserClient) {
    return browserClient;
  }

  const url = getSupabaseUrl();
  const anon = getSupabasePublishableKey();
  if (!url || !anon) {
    return null;
  }

  browserClient = createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: createSupabaseFetch(anon),
    },
  });
  return browserClient;
}

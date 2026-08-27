"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/**
 * Browser Supabase client for Realtime subscriptions.
 * Requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY.
 * Returns null when unset so the dictionary still works (delta poll fallback).
 */
export function getSupabaseBrowser(): SupabaseClient | null {
  if (browserClient) {
    return browserClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anon) {
    return null;
  }

  browserClient = createClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return browserClient;
}

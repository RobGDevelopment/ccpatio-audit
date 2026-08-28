"use client";

import { useTransition } from "react";
import { logoutPimOperator } from "@/app/register-actions";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

export function LogoutButton() {
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      const supabase = getSupabaseBrowser();
      if (supabase) {
        await supabase.auth.signOut();
      }
      await logoutPimOperator();
    });
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className="rounded-md border border-slate-700/60 px-3 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

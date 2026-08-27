"use client";

import { logoutPimOperator } from "@/app/register-actions";

export function LogoutButton() {
  return (
    <form action={logoutPimOperator}>
      <button
        type="submit"
        className="rounded-md border border-slate-700/60 px-3 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
      >
        Sign out
      </button>
    </form>
  );
}

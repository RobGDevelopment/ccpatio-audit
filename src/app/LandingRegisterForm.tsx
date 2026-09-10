"use client";

import { useActionState } from "react";
import { registerPimOperator, staffSignUpAction } from "./register-actions";

export function LandingRegisterForm() {
  const [state, formAction, isPending] = useActionState(
    registerPimOperator,
    null,
  );

  const [signUpState, signUpFormAction, isSignUpPending] = useActionState(
    staffSignUpAction,
    null,
  );

  const activeError = (state && !state.ok ? state.error : null) || (signUpState && !signUpState.ok ? signUpState.error : null);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value="/admin/quarantine" />
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Work email
        </span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@ccpatio.com"
          className="pim-input w-full py-2.5 text-sm"
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-400">
          Password
        </span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="pim-input w-full py-2.5 text-sm"
        />
      </label>
      {activeError ? (
        <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
          {activeError}
        </p>
      ) : null}
      
      <div className="space-y-2 pt-2">
        <button
          type="submit"
          disabled={isPending || isSignUpPending}
          className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
        >
          {isPending ? "Signing in…" : "Enter Launchpad →"}
        </button>
        
        <button
          type="submit"
          formAction={signUpFormAction}
          disabled={isPending || isSignUpPending}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-3 text-sm font-semibold text-zinc-300 transition hover:bg-zinc-800 disabled:opacity-60"
        >
          {isSignUpPending ? "Creating Account…" : "Create @ccpatio.com Account"}
        </button>
      </div>

      <p className="text-center text-[11px] text-slate-500 pt-2">
        Access is restricted to authorized personnel.
      </p>
    </form>
  );
}

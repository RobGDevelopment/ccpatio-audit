"use client";

import { useActionState } from "react";
import { registerPimOperator } from "./register-actions";

type LandingRegisterFormProps = {
  nextPath: string;
};

export function LandingRegisterForm({ nextPath }: LandingRegisterFormProps) {
  const [state, formAction, isPending] = useActionState(
    registerPimOperator,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={nextPath} />
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
          Display name
        </span>
        <input
          type="text"
          name="display_name"
          required
          autoComplete="name"
          placeholder="Jane Smith"
          className="pim-input w-full py-2.5 text-sm"
        />
      </label>
      {state && !state.ok ? (
        <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
      >
        {isPending ? "Signing in…" : "Enter PIM Dictionary →"}
      </button>
      <p className="text-center text-[11px] text-slate-500">
        Your email is stamped on every edit for accountability.
      </p>
    </form>
  );
}

"use client";

import Link from "next/link";
import { LogoutButton } from "@/app/admin/LogoutButton";
import {
  LAUNCHPAD_MODULES,
  STATUS_STYLES,
  type LaunchpadModule,
} from "@/lib/launchpad-modules";
import { cn } from "@/lib/utils";

const HIGHLIGHTED_PIM_TITLES = new Set([
  "Global SKU Dictionary",
  "Raw Materials Catalog",
]);

type ExecutiveLaunchpadProps = {
  operatorEmail: string;
  operatorName: string;
};

function ModuleCard({ module }: { module: LaunchpadModule }) {
  const isExternal = module.href.startsWith("/api/");
  const isHighlighted = HIGHLIGHTED_PIM_TITLES.has(module.title);

  const card = (
    <article
      className={cn(
        "group pim-glass flex h-full flex-col rounded-xl p-5 transition",
        isHighlighted
          ? "border-cyan-500/60 shadow-[0_0_20px_rgba(6,182,212,0.3)] animate-[pulse_3s_ease-in-out_infinite]"
          : "hover:border-emerald-500/30 hover:bg-slate-950/60",
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold tracking-tight text-slate-100 group-hover:text-emerald-200">
          {module.title}
        </h3>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_STYLES[module.status]}`}
        >
          {module.status}
        </span>
      </div>
      <p className="flex-1 text-sm leading-relaxed text-slate-400">
        {module.description}
      </p>
      <p className="mt-4 text-xs font-medium text-emerald-400/90 group-hover:text-emerald-300">
        Open module →
      </p>
    </article>
  );

  if (isExternal) {
    return (
      <a href={module.href} target="_blank" rel="noopener noreferrer">
        {card}
      </a>
    );
  }

  return <Link href={module.href}>{card}</Link>;
}

export function ExecutiveLaunchpad({
  operatorEmail,
  operatorName,
}: ExecutiveLaunchpadProps) {
  return (
    <main className="pim-carbon-shell min-h-screen text-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
        <header className="pim-glass mb-8 rounded-xl px-6 py-5 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">
                CC Patio · Enterprise PIM Terminal
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                Executive Launchpad
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Signed in as{" "}
                <span className="font-medium text-slate-200">{operatorName}</span>{" "}
                <span className="text-slate-500">({operatorEmail})</span>
              </p>
            </div>
            <LogoutButton />
          </div>
        </header>

        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              Active modules
            </h2>
            <p className="text-xs text-slate-600">
              {LAUNCHPAD_MODULES.length} tools available
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {LAUNCHPAD_MODULES.map((module) => (
              <ModuleCard key={module.id} module={module} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

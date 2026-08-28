import Link from "next/link";
import { LandingRegisterForm } from "./LandingRegisterForm";
import { ExecutiveLaunchpad } from "@/components/ExecutiveLaunchpad";
import { getPimSession } from "@/lib/pim-audit";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getPimSession();

  if (session) {
    return (
      <ExecutiveLaunchpad
        operatorEmail={session.email}
        operatorName={session.name}
      />
    );
  }

  return (
    <main className="pim-carbon-shell min-h-screen text-slate-50">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:gap-16 lg:py-16">
        <section className="flex-1 space-y-6">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-500">
            CC Patio · Enterprise PIM Terminal
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-50 sm:text-5xl">
            Executive Launchpad
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-slate-400">
            One secure entry point for the Global SKU Dictionary, topology
            blueprint, operations command center, and middleware health checks.
            Register with your CC Patio email to open the module selector.
          </p>
          <ul className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
            <li className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3">
              <span className="font-medium text-emerald-300">PIM Dictionary</span>
              <p className="mt-1 text-slate-400">
                Finished goods, raw materials, and integration field completion.
              </p>
            </li>
            <li className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3">
              <span className="font-medium text-emerald-300">Topology Blueprint</span>
              <p className="mt-1 text-slate-400">
                E2E lifecycle zones, pipelines, and manufacturing sequences.
              </p>
            </li>
            <li className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3">
              <span className="font-medium text-emerald-300">Command Center</span>
              <p className="mt-1 text-slate-400">
                Executive briefings, training gates, and margin visibility.
              </p>
            </li>
            <li className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-4 py-3">
              <span className="font-medium text-emerald-300">Audit & Health</span>
              <p className="mt-1 text-slate-400">
                Change logs and deployment diagnostics in one place.
              </p>
            </li>
          </ul>
        </section>

        <section className="mt-10 w-full max-w-md shrink-0 lg:mt-0">
          <div className="pim-glass rounded-xl p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-slate-100">Team access</h2>
            <p className="mt-2 text-sm text-slate-400">
              Register with your CC Patio email to unlock the module selector.
            </p>
            <div className="mt-6">
              <LandingRegisterForm />
            </div>
            <p className="mt-6 text-center text-xs text-slate-600">
              <Link href="/api/health" className="hover:text-slate-400">
                System health
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

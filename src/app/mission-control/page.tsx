import { requireMissionControlAuth, getFailedJobsAction } from "./actions";
import { TrafficLights } from "@/components/mission-control/TrafficLights";
import { IssuesInbox } from "@/components/mission-control/IssuesInbox";
import { KeyManager } from "@/components/mission-control/KeyManager";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MissionControlPage() {
  try {
    await requireMissionControlAuth();
  } catch (error) {
    redirect("/"); // If not SuperAdmin or IT_Admin, kick them back to Launchpad
  }

  // Fetch initial failed jobs for the Inbox
  const jobsRes = await getFailedJobsAction();
  const initialJobs = jobsRes.ok ? jobsRes.data?.data || [] : []; // Inngest returns { data: [...] } for /v1/runs

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold tracking-wide text-zinc-100 uppercase">
              CC Patio <span className="text-zinc-500">/</span> Mission Control
            </h1>
            <span className="rounded bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-400 uppercase tracking-widest border border-rose-500/20">
              Restricted Area
            </span>
          </div>
          <a href="/" className="text-xs font-medium text-zinc-400 hover:text-zinc-200 transition">
            ← Back to Launchpad
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6 py-8 space-y-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">System Diagnostics</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Real-time status of the CC Patio Master Data Hub, cross-platform integrations, and background tasks.
          </p>
        </div>

        {/* Top section: Traffic Lights */}
        <section>
          <TrafficLights />
        </section>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main section: Issues Inbox */}
          <section className="lg:col-span-2">
            <IssuesInbox initialJobs={initialJobs} />
          </section>

          {/* Sidebar: Key Manager */}
          <section className="lg:col-span-1">
            <KeyManager />
          </section>
        </div>
      </main>
    </div>
  );
}

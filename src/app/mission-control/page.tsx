import { requireMissionControlAuth } from "./actions";
import { TrafficLights } from "@/components/mission-control/TrafficLights";
import { IssuesInbox } from "@/components/mission-control/IssuesInbox";
import { KeyManager } from "@/components/mission-control/KeyManager";
import { EscalationModal } from "@/components/mission-control/EscalationModal";
import { HygieneRadar } from "@/components/mission-control/HygieneRadar";
import { GoldBeam } from "@/components/ui/GoldBeam";
import { canvas, eyebrow } from "@/components/mission-control/soft-ui";
import { MissionControlUnauthorizedError } from "@/server/mission-control/require-role";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MissionControlPage() {
  let session: Awaited<ReturnType<typeof requireMissionControlAuth>>;
  try {
    session = await requireMissionControlAuth();
  } catch (error) {
    if (!(error instanceof MissionControlUnauthorizedError)) throw error;
    redirect("/");
  }

  return (
    <div className={canvas}>
      <header className="sticky top-0 z-30 bg-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-md">
        <GoldBeam />
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-sm font-semibold uppercase tracking-widest text-slate-900">
              CC Patio <span className="text-slate-300">/</span> Mission Control
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-slate-700">
              {session.role}
            </span>
            <EscalationModal />
          </div>
          <a href="/" className="text-xs font-medium text-slate-500 transition hover:text-slate-900">
            ← Back to Launchpad
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 p-6 py-10">
        <div>
          <div className={eyebrow}>Restricted area</div>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">System Diagnostics</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            Live status of QuickBooks, GoHighLevel, Katana and the dead-letter queue, plus the products that
            could stall a quote.
          </p>
        </div>

        <section aria-label="System health">
          <TrafficLights />
        </section>

        <section aria-label="Catalog hygiene">
          <HygieneRadar />
        </section>

        <div className="grid gap-8 lg:grid-cols-3">
          <section className="lg:col-span-2" aria-label="Issues inbox">
            <IssuesInbox />
          </section>

          <section className="lg:col-span-1" aria-label="Connection manager">
            <KeyManager />
          </section>
        </div>
      </main>
    </div>
  );
}

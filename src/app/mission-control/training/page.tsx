import { requireMissionControlAuth } from "../actions";
import { TrainingHub } from "@/components/mission-control/TrainingHub";
import { GoldBeam } from "@/components/ui/GoldBeam";
import { canvas, eyebrow } from "@/components/mission-control/soft-ui";
import { MissionControlUnauthorizedError } from "@/server/mission-control/require-role";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MissionControlTrainingPage() {
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
              CC Patio <span className="text-slate-300">/</span> Mission Control{" "}
              <span className="text-slate-300">/</span> Digital Training Hub
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-slate-700">
              {session.role}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/mission-control"
              className="text-xs font-medium text-slate-500 transition hover:text-slate-900"
            >
              ← Back to Mission Control
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 p-6 py-10">
        <div>
          <div className={eyebrow}>Shop Floor Tablet Portal • SOP-OPS-KATANA-002 v2.1</div>
          <h2 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
            Katana MRP Digital Training Hub
          </h2>
          <p className="mt-2 max-w-3xl text-base text-slate-500">
            Interactive, role-based Standard Operating Procedures and embedded video training for
            Receiving Dock, Warehouse, Floor Foremen, and Shop Floor Tablet Operators.
          </p>
        </div>

        <TrainingHub />
      </main>
    </div>
  );
}

import { TrainingHub } from "@/components/mission-control/TrainingHub";

export const dynamic = "force-dynamic";

export default function EmbedTrainingPage() {
  return (
    <main className="h-full min-h-0 flex-1 overflow-y-auto bg-[#FAFAFA] text-slate-900">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
        <TrainingHub />
      </div>
    </main>
  );
}

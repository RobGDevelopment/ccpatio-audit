import Link from "next/link";
import { PresentationDashboard } from "@/components/PresentationDashboard";

export default function PresentationPage() {
  return (
    <div className="relative h-screen w-screen">
      <div className="absolute left-4 top-4 z-50">
        <Link
          href="/"
          className="rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-slate-300 backdrop-blur hover:border-emerald-500/40 hover:text-emerald-300"
        >
          ← Launchpad
        </Link>
      </div>
      <PresentationDashboard />
    </div>
  );
}

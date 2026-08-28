"use client";

import Link from "next/link";
import TopologyDashboard from "@/components/topology/TopologyDashboard";
import { useTopologyStore } from "@/components/topology/topologyStore";

export default function TopologyPage() {
  const movieMode = useTopologyStore((s) => s.movieMode);

  return (
    <div
      className={
        movieMode
          ? "pim-carbon-shell fixed inset-0 z-[200] flex flex-col bg-[#030712]"
          : "pim-carbon-shell flex h-screen flex-col overflow-hidden bg-[#030712]"
      }
    >
      <div className="absolute left-4 top-4 z-[210]">
        <Link
          href="/"
          className="rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-slate-300 backdrop-blur hover:border-emerald-500/40 hover:text-emerald-300"
        >
          ← Launchpad
        </Link>
      </div>
      <TopologyDashboard />
    </div>
  );
}

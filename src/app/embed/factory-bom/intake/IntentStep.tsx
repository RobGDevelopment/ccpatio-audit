"use client";

import React, { useState } from "react";
import { UserCheck, Sparkles, ArrowRight, ArrowLeft } from "lucide-react";
import { GoldBeam } from "@/components/ui/GoldBeam";

export type IntakeIntent = "client_project" | "catalog";

interface IntentStepProps {
  initialIntent?: IntakeIntent | null;
  hasOpportunityParam?: boolean;
  onBack: () => void;
  onSelectIntent: (intent: IntakeIntent) => void;
}

export function IntentStep({
  initialIntent = null,
  hasOpportunityParam = false,
  onBack,
  onSelectIntent,
}: IntentStepProps) {
  const [selected, setSelected] = useState<IntakeIntent | null>(
    initialIntent || (hasOpportunityParam ? "client_project" : null)
  );

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
          Who is this piece for?
        </h2>
        <p className="text-xs text-stone-500">
          Choose whether this is a custom order for a client or a standard product.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Client Project Card */}
        <div
          onClick={() => setSelected("client_project")}
          className={`relative overflow-hidden cursor-pointer rounded-2xl p-6 transition-all duration-200 border text-left ${
            selected === "client_project"
              ? "bg-white dark:bg-stone-900 border-amber-500 shadow-md ring-2 ring-amber-500/20"
              : "bg-white/60 dark:bg-stone-900/60 hover:bg-white dark:hover:bg-stone-900 border-stone-200/80 dark:border-stone-800/80 hover:border-stone-300 dark:hover:border-stone-700 shadow-sm"
          }`}
        >
          {selected === "client_project" && <GoldBeam active={true} />}
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4 border border-amber-500/20">
            <UserCheck className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-stone-900 dark:text-stone-100 mb-1">
            A client&apos;s project
          </h3>
          <p className="text-xs text-stone-500 leading-relaxed">
            Built for one customer. Links directly to a GoHighLevel project, captures finishes, and attaches the factory order.
          </p>
        </div>

        {/* Standard Catalog Card */}
        <div
          onClick={() => setSelected("catalog")}
          className={`relative overflow-hidden cursor-pointer rounded-2xl p-6 transition-all duration-200 border text-left ${
            selected === "catalog"
              ? "bg-white dark:bg-stone-900 border-amber-500 shadow-md ring-2 ring-amber-500/20"
              : "bg-white/60 dark:bg-stone-900/60 hover:bg-white dark:hover:bg-stone-900 border-stone-200/80 dark:border-stone-800/80 hover:border-stone-300 dark:hover:border-stone-700 shadow-sm"
          }`}
        >
          {selected === "catalog" && <GoldBeam active={true} />}
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-4 border border-amber-500/20">
            <Sparkles className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-stone-900 dark:text-stone-100 mb-1">
            A standard catalog product
          </h3>
          <p className="text-xs text-stone-500 leading-relaxed">
            We&apos;ll make this again. Adds to the master collection with verified nomenclature and dimensions.
          </p>
        </div>
      </div>

      <div className="pt-2 flex items-center justify-between space-x-3">
        <button
          type="button"
          onClick={onBack}
          className="h-12 px-5 flex items-center space-x-2 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 text-stone-700 dark:text-stone-300 text-xs font-semibold hover:bg-stone-50 dark:hover:bg-stone-800 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <button
          type="button"
          disabled={!selected}
          onClick={() => {
            if (selected) onSelectIntent(selected);
          }}
          className="h-12 flex-1 flex items-center justify-center space-x-2 rounded-2xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:pointer-events-none text-white font-semibold text-sm shadow-sm transition"
        >
          <span>Continue</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { FactoryProductRow } from "@/server/factory-bom/list-factory-products";
import type { IntakeSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import type { IntakeSubject } from "@/server/factory-bom/intake/load-subject";
import {
  continueButton,
  glassCard,
  quietButton,
  ticket,
} from "@/app/admin/factory-bom/factory-bom-ui";
import { Step1Cad, step1AllowsContinue } from "./steps/Step1Cad";

// Lazy-load Steps 2, 3, 4 so they are not in the first-load bundle
const Step2Materials = dynamic(
  () => import("./steps/Step2Materials").then((m) => m.Step2Materials),
  {
    ssr: false,
    loading: () => (
      <div className="py-12 flex justify-center text-xs text-stone-400">
        Loading materials check…
      </div>
    ),
  }
);

const Step3Operations = dynamic(
  () => import("./steps/Step3Operations").then((m) => m.Step3Operations),
  {
    ssr: false,
    loading: () => (
      <div className="py-12 flex justify-center text-xs text-stone-400">
        Loading build steps…
      </div>
    ),
  }
);

const Step4Release = dynamic(
  () => import("./steps/Step4Release").then((m) => m.Step4Release),
  {
    ssr: false,
    loading: () => (
      <div className="py-12 flex justify-center text-xs text-stone-400">
        Loading final review…
      </div>
    ),
  }
);

type ProductMeta = FactoryProductRow & {
  itemType?: string;
  category?: string;
  katanaVariantId?: number | null;
};

interface DesignWizardProps {
  subject?: IntakeSubject | null;
  snapshot: IntakeSnapshot | null;
  products: ProductMeta[];
  reportedUserEmail?: string;
  opportunityId?: string;
}

export function DesignWizard({
  subject,
  snapshot,
  products,
  reportedUserEmail,
}: DesignWizardProps) {
  const [step, setStep] = useState<number>(1);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const sku = snapshot?.rootSku || subject?.sku || "";
  const originalName = subject?.name || "";
  const isClientPiece = Boolean(subject?.customBuild || sku.startsWith("JOB-"));
  const hasPacket = Boolean(subject?.packet);

  const canContinue =
    step === 4
      ? false
      : !snapshot
      ? false
      : step !== 1 || step1AllowsContinue(snapshot, originalName, isClientPiece, hasPacket);

  const stepTitles = [
    "Piece & 3D model",
    "Materials check",
    "Build steps & shipping",
    "Final review",
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-stone-950 p-4 sm:p-6 font-sans items-center justify-center">
      <div className={`flex h-[88vh] w-full max-w-3xl flex-col p-6 sm:p-8 ${glassCard}`}>
        {/* Header */}
        <div className="mb-4 flex flex-col gap-3 border-b border-stone-200/80 dark:border-stone-800/80 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-stone-900 dark:text-stone-100">
                {originalName || "Design Review"}
              </h1>
              <p className="text-xs text-stone-500 font-mono">
                Item code: {sku}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-2 pt-1">
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((s) => (
                <div
                  key={s}
                  className={`h-2 w-2 rounded-full transition-colors duration-150 ${
                    s === step
                      ? "bg-amber-500 ring-2 ring-amber-500/20"
                      : s < step
                      ? "bg-amber-300 dark:bg-amber-700"
                      : "bg-stone-200 dark:bg-stone-800"
                  }`}
                />
              ))}
            </div>
            <h2 className="text-xs font-semibold text-stone-500 dark:text-stone-400">
              Step {step}: {stepTitles[step - 1]}
            </h2>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-1">
          {!snapshot ? (
            <div className="flex h-full items-center justify-center text-xs text-stone-500">
              No design snapshot found for this piece.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {step === 1 && (
                <Step1Cad
                  snapshot={snapshot}
                  subject={subject}
                  originalName={originalName}
                  itemType={subject?.itemType || "finished_good"}
                  isPending={false}
                  reportedUserEmail={reportedUserEmail}
                />
              )}
              {step === 2 && (
                <Step2Materials snapshot={snapshot} products={products} />
              )}
              {step === 3 && <Step3Operations snapshot={snapshot} />}
              {step === 4 && (
                <Step4Release snapshot={snapshot} products={products} />
              )}
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="mt-4 flex items-center justify-between border-t border-stone-200/80 dark:border-stone-800/80 pt-4">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className={quietButton}
          >
            Back
          </button>
          {step < 4 && (
            <button
              type="button"
              disabled={!hydrated || !canContinue}
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              className={continueButton}
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

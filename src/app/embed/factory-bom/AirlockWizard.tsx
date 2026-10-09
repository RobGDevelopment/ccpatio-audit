"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FactoryProductRow } from "@/server/factory-bom/list-factory-products";
import type { AirlockSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import {
  continueButton,
  glassCard,
  quietButton,
  ticket,
} from "@/app/admin/factory-bom/factory-bom-ui";
import { Step1Cad, step1AllowsContinue } from "./steps/Step1Cad";
import { Step2Materials } from "./steps/Step2Materials";
import { Step3Operations } from "./steps/Step3Operations";
import { Step4Release } from "./steps/Step4Release";
import { IntakeDropzone } from "./IntakeDropzone";

export function AirlockWizard({
  products,
  initialSku,
  snapshot,
  opportunityId,
}: {
  products: FactoryProductRow[];
  initialSku?: string;
  snapshot: AirlockSnapshot | null;
  opportunityId?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<number>(1);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const selected = products.find((product) => product.sku === initialSku);
  const originalName = selected?.name ?? "";
  const canContinue =
    step === 4
      ? false
      : !snapshot
        ? false
        : step !== 1 || step1AllowsContinue(snapshot, originalName);

  const stepTitles = [
    "Identity & CAD",
    "Cut List Verification",
    "Operations & Logistics",
    "Release Gate",
  ];

  if (!initialSku) {
    return <IntakeDropzone opportunityId={opportunityId} />;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-slate-50 p-6 font-sans items-center justify-center">
      <div className={`flex h-[80vh] w-full max-w-3xl flex-col p-6 sm:p-8 ${glassCard}`}>
        <div className="mb-4 flex flex-col gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-xl font-bold text-zinc-800">
              Airlock: {initialSku}
            </h1>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((s) => (
                <div
                  key={s}
                  className={`h-2.5 w-2.5 rounded-full transition-colors duration-150 ${
                    s === step
                      ? "bg-emerald-600"
                      : s < step
                      ? "bg-emerald-300"
                      : "bg-slate-200"
                  }`}
                />
              ))}
            </div>
            <h2 className="text-sm font-semibold text-zinc-500">
              Step {step}: {stepTitles[step - 1]}
            </h2>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!snapshot ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              No airlock snapshot for this SKU.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {step === 1 && (
                <Step1Cad
                  snapshot={snapshot}
                  originalName={originalName}
                  itemType="finished_good"
                  isPending={false}
                />
              )}
              {step === 2 && <Step2Materials snapshot={snapshot} products={products} />}
              {step === 3 && <Step3Operations snapshot={snapshot} />}
              {step === 4 && <Step4Release snapshot={snapshot} products={products} />}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className={quietButton}
          >
            Back
          </button>
          <button
            type="button"
            disabled={!hydrated || !canContinue}
            onClick={() => setStep((s) => Math.min(4, s + 1))}
            className={continueButton}
          >
            {step === 4 ? "Submit" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FactoryProductRow } from "@/server/factory-bom/list-factory-products";
import type { AirlockSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import { Step1Cad, step1AllowsContinue } from "./steps/Step1Cad";
import { Step2Materials } from "./steps/Step2Materials";
import { Step3Operations } from "./steps/Step3Operations";
import { Step4Release } from "./steps/Step4Release";

export function AirlockWizard({
  products,
  initialSku,
  snapshot,
}: {
  products: FactoryProductRow[];
  initialSku?: string;
  snapshot: AirlockSnapshot | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<number>(1);
  const selected = products.find((product) => product.sku === initialSku);
  const originalName = selected?.name ?? "";
  const canContinue =
    step === 4
      ? false
      : !snapshot
        ? false
        : step !== 1 || step1AllowsContinue(snapshot, originalName);

  const handleSkuChange = (sku: string) => {
    if (sku) {
      router.replace(`?sku=${encodeURIComponent(sku)}`);
    } else {
      router.replace(`?`);
    }
  };

  const stepTitles = [
    "Identity & CAD",
    "Cut List Verification",
    "Operations & Logistics",
    "Release Gate",
  ];

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-slate-50 font-sans p-6 items-center justify-center">
      {/* Central Glass Card */}
      <div className="w-full max-w-3xl bg-white/80 backdrop-blur-md rounded-2xl border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.06)] p-6 sm:p-8 flex flex-col h-[80vh]">
        
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 mb-4">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold text-slate-800">
              {initialSku ? `Airlock: ${initialSku}` : "Airlock Wizard"}
            </h1>
            <select
              className="text-sm border border-slate-300 rounded px-2 py-1"
              value={initialSku || ""}
              onChange={(e) => handleSkuChange(e.target.value)}
            >
              <option value="">Select Product...</option>
              {products.map((p) => (
                <option key={p.sku} value={p.sku}>
                  {p.sku} - {p.name}
                </option>
              ))}
            </select>
          </div>
          
          {initialSku && (
            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-2">
                {[1, 2, 3, 4].map((s) => (
                  <div
                    key={s}
                    className={`w-2.5 h-2.5 rounded-full ${
                      s === step
                        ? "bg-blue-600"
                        : s < step
                        ? "bg-blue-300"
                        : "bg-slate-200"
                    }`}
                  />
                ))}
              </div>
              <h2 className="text-sm font-semibold text-slate-600">
                Step {step}: {stepTitles[step - 1]}
              </h2>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {!initialSku ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              Please select a product to begin.
            </div>
          ) : !snapshot ? (
            <div className="flex h-full items-center justify-center text-slate-500">
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

        {/* Footer */}
        {initialSku && (
          <div className="flex justify-between items-center border-t border-slate-200 pt-4 mt-4">
            <button
              disabled={step === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="min-h-11 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Back
            </button>
            <button
              disabled={!canContinue}
              onClick={() => setStep((s) => Math.min(4, s + 1))}
              className="min-h-11 px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {step === 4 ? "Submit" : "Continue"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

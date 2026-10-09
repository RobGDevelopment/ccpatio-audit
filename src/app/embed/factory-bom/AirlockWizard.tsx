"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FactoryProductRow } from "@/server/factory-bom/list-factory-products";
import type { AirlockSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import {
  continueButton,
  glassCard,
  quietButton,
  skuMenu,
  ticket,
} from "@/app/admin/factory-bom/factory-bom-ui";
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
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-slate-50 p-6 font-sans items-center justify-center">
      <div className={`flex h-[80vh] w-full max-w-3xl flex-col p-6 sm:p-8 ${glassCard}`}>
        <div className="mb-4 flex flex-col gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-xl font-bold text-zinc-800">
              {initialSku ? `Airlock: ${initialSku}` : "Airlock Wizard"}
            </h1>
            <SkuPicker
              products={products}
              initialSku={initialSku}
              onChange={handleSkuChange}
            />
          </div>

          {initialSku && (
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
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {!initialSku ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Choose a SKU to open this airlock.
            </div>
          ) : !snapshot ? (
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

        {initialSku && (
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
        )}
      </div>
    </div>
  );
}

function SkuPicker({
  products,
  initialSku,
  onChange,
}: {
  products: FactoryProductRow[];
  initialSku?: string;
  onChange: (sku: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = products.find((product) => product.sku === initialSku);
  const label = selected ? `${selected.sku} — ${selected.name}` : "Choose a SKU";

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`${quietButton} max-w-xs truncate border border-slate-200 bg-white/80 px-3 text-left`}
      >
        <span className={selected ? ticket : "text-zinc-500"}>{label}</span>
      </button>
      {open ? (
        <ul role="listbox" className={skuMenu}>
          <li>
            <button
              type="button"
              role="option"
              aria-selected={!initialSku}
              className={`${quietButton} w-full justify-start px-3 text-left text-zinc-500`}
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear SKU
            </button>
          </li>
          {products.map((product) => (
            <li key={product.sku}>
              <button
                type="button"
                role="option"
                aria-selected={product.sku === initialSku}
                className={`${quietButton} flex w-full items-baseline justify-start gap-2 px-3 text-left ${
                  product.sku === initialSku ? "bg-emerald-50 text-emerald-800" : ""
                }`}
                onClick={() => {
                  onChange(product.sku);
                  setOpen(false);
                }}
              >
                <span className={`${ticket} shrink-0 whitespace-nowrap`}>{product.sku}</span>
                <span className="min-w-0 truncate text-zinc-500">{product.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

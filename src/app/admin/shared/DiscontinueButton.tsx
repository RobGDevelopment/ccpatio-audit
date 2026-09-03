"use client";

import { useState } from "react";
import { discontinueSku } from "./actions";

export function DiscontinueButton({
  globalSku,
  operatorEmail = "operator@ccpatio.com",
}: {
  globalSku: string;
  operatorEmail?: string;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDiscontinue = async () => {
    setIsSubmitting(true);
    try {
      await discontinueSku(globalSku, operatorEmail);
      setIsConfirming(false);
    } catch (e) {
      console.error("Failed to discontinue SKU", e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsConfirming(true)}
        className="rounded-md border border-red-900/50 bg-red-950/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/40 hover:text-red-300 transition"
      >
        Mark Discontinued
      </button>

      {isConfirming && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-red-900 bg-zinc-950 p-6 shadow-2xl">
            <h3 className="mb-2 text-lg font-bold text-red-500">Discontinue Item?</h3>
            <p className="mb-6 text-sm text-zinc-300 leading-relaxed">
              Are you sure you want to discontinue <strong>{globalSku}</strong>? 
              This will mark it inactive in the portal and send a command to 
              Katana to archive this variant, removing it from factory floors.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsConfirming(false)}
                disabled={isSubmitting}
                className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDiscontinue}
                disabled={isSubmitting}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 shadow-[0_0_15px_rgba(220,38,38,0.3)]"
              >
                {isSubmitting ? "Archiving..." : "Yes, Discontinue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

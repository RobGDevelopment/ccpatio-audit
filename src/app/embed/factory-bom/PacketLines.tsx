"use client";

import { useState } from "react";
import { IntakeDropzone } from "./IntakeDropzone";

export type PacketLineResult = {
  rawLine: string;
  isCustom: boolean;
  snapToGlobalSku: string | null;
  parsed: any;
};

export function PacketLines({ lines, opportunityId }: { lines: PacketLineResult[], opportunityId?: string }) {
  return (
    <div className="flex flex-col gap-4 w-full">
      {lines.map((line, i) => (
        <div key={i} className="border border-slate-200 p-6 rounded-xl bg-white shadow-sm flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <span className="font-mono text-sm font-medium text-slate-700">{line.rawLine}</span>
            {line.isCustom ? (
              <span className="text-xs font-bold tracking-wide text-amber-700 bg-amber-50 px-3 py-1 rounded-full uppercase border border-amber-200">Custom Line</span>
            ) : (
              <span className="text-xs font-bold tracking-wide text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full uppercase border border-emerald-200">BOM Certified</span>
            )}
          </div>
          {!line.isCustom && line.snapToGlobalSku && (
             <div className="text-xs text-slate-500">Snapped to {line.snapToGlobalSku}</div>
          )}
          
          {line.isCustom && (
            <div className="border-t border-slate-100 pt-6 mt-2">
              <IntakeDropzone opportunityId={opportunityId} restrictPdf={true} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

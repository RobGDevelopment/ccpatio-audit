import { useState, useMemo } from "react";
import type { AirlockSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import type { FactoryProductRow } from "@/server/factory-bom/list-factory-products";
import { evaluateAirlock } from "@/server/factory-bom/evaluate-airlock";
import type { AirlockDossier } from "@/server/factory-bom/airlock.schema";

export function Step4Release({
  snapshot,
  products,
}: {
  snapshot: AirlockSnapshot;
  products: FactoryProductRow[];
}) {
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [cutListConfirmed, setCutListConfirmed] = useState(false);
  const [operationsConfirmed, setOperationsConfirmed] = useState(false);
  const [quarantineConfirmed, setQuarantineConfirmed] = useState(false);

  const allChecked = identityConfirmed && cutListConfirmed && operationsConfirmed && quarantineConfirmed;

  const blockingCodes = useMemo(() => {
    const rootMeta = products.find(p => p.sku === snapshot.rootSku);
    if (!rootMeta) return ["MISSING_ROOT_META"];

    let cadNode = null;
    if (snapshot.cadUpload && (snapshot.cadUpload.ext === "dae" || snapshot.cadUpload.ext === "glb")) {
      const snap = snapshot.cadUpload.geometry_snapshot as any;
      cadNode = {
        uploadId: snapshot.cadUpload.id,
        ext: snapshot.cadUpload.ext as "dae" | "glb",
        status: (snapshot.cadUpload.status === "failed" ? "failed" : "draft_ready") as "draft_ready" | "failed",
        sha256: snapshot.cadUpload.sha256 || "",
        hygiene: (snap?.hygiene === "pass" ? "pass" : "fail") as "pass" | "fail",
      };
    }

    const allSkus = new Set<string>();
    allSkus.add(snapshot.rootSku);
    snapshot.lines.forEach(l => {
      allSkus.add(l.parent_sku);
      allSkus.add(l.child_sku);
    });

    const parents = Array.from(allSkus).filter(s => 
      s === snapshot.rootSku || snapshot.lines.some(l => l.parent_sku === s)
    );

    const nodes = parents.map(parentSku => {
      const pMeta = products.find(p => p.sku === parentSku);
      const parentLines = snapshot.lines.filter(l => l.parent_sku === parentSku).map(l => {
         const cMeta = products.find(p => p.sku === l.child_sku);
         const cat = (cMeta as any)?.category || "";
         const isMetal = Boolean(
           cat.match(/metal|aluminum|tube|flat bar/i) ||
           (Array.isArray(l.cut_list) && l.cut_list.length > 0 && (l.cut_list[0] as any).profile !== "UNKNOWN") ||
           ((l.unit_of_measure === "in" || l.unit_of_measure === "ft") && Array.isArray(l.cut_list) && l.cut_list.length > 0)
         );
         
         return {
           parentSku: l.parent_sku,
           childSku: l.child_sku,
           itemType: (cMeta as any)?.itemType || "raw_material",
           quantity: Number(l.quantity),
           scrapFactor: Number(l.scrap_factor),
           unitOfMeasure: l.unit_of_measure as any,
           status: l.status as any,
           source: l.source,
           notes: l.notes,
           cutList: Array.isArray(l.cut_list) ? l.cut_list.map((c: any) => ({
             role: c.role || "",
             profile: c.profile || "UNKNOWN",
             lengthIn: Number(c.lengthIn) || 0,
             endA: c.endA,
             endB: c.endB,
             qtyEa: c.qtyEa,
             lengthConvention: c.lengthConvention,
             sourceName: c.sourceName || "",
             confidence: c.confidence,
             drawingPartNumber: c.drawingPartNumber
           })) : [],
           isMetal
         };
      });
      const parentOps = snapshot.operations.filter(o => o.item_sku === parentSku).map(o => ({
         itemSku: o.item_sku,
         workCenter: o.work_center,
         sequence: o.sequence,
         setupTimeMins: o.setup_time_mins ? Number(o.setup_time_mins) : 0,
         runTimeMins: o.run_time_mins ? Number(o.run_time_mins) : 0,
      }));
      return {
        sku: parentSku,
        itemType: (pMeta as any)?.itemType || "sub_assembly",
        lines: parentLines,
        operations: parentOps,
      };
    });

    const dossier: AirlockDossier = {
      rootSku: snapshot.rootSku,
      identity: {
        itemType: (rootMeta as any).itemType || "finished_good",
        originalName: rootMeta.name || "",
        katanaVariantId: (rootMeta as any).katanaVariantId || null,
        cad: cadNode,
        cadWaived: false,
      },
      nodes,
      checklist: {
        identityConfirmed: identityConfirmed as true,
        cutListConfirmed: cutListConfirmed as true,
        operationsConfirmed: operationsConfirmed as true,
        quarantineConfirmed: quarantineConfirmed as true,
      },
    };

    try {
      return evaluateAirlock(dossier);
    } catch (err: any) {
      return ["ENGINE_ERROR: " + err.message];
    }
  }, [snapshot, products, identityConfirmed, cutListConfirmed, operationsConfirmed, quarantineConfirmed]);

  const canRelease = allChecked && blockingCodes.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-bold text-slate-800">Quarantine Gate Attestation</h2>
        <p className="text-sm text-slate-600">Please confirm all structural parameters before releasing to the live factory floor.</p>
      </div>

      <div className="flex flex-col gap-4 border border-slate-200 rounded-lg p-6 bg-slate-50">
        <label className="flex items-center gap-3 cursor-pointer min-h-11">
          <input
            type="checkbox"
            className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
            checked={identityConfirmed}
            onChange={(e) => setIdentityConfirmed(e.target.checked)}
          />
          <span className="text-sm font-medium text-slate-700">Identity: Product and CAD match precisely.</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer min-h-11">
          <input
            type="checkbox"
            className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
            checked={cutListConfirmed}
            onChange={(e) => setCutListConfirmed(e.target.checked)}
          />
          <span className="text-sm font-medium text-slate-700">Cut List: Material yield has been verified.</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer min-h-11">
          <input
            type="checkbox"
            className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
            checked={operationsConfirmed}
            onChange={(e) => setOperationsConfirmed(e.target.checked)}
          />
          <span className="text-sm font-medium text-slate-700">Operations: Routing and times are scheduled.</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer min-h-11">
          <input
            type="checkbox"
            className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
            checked={quarantineConfirmed}
            onChange={(e) => setQuarantineConfirmed(e.target.checked)}
          />
          <span className="text-sm font-medium text-slate-700">Acknowledgement: I am releasing this to live Katana production.</span>
        </label>
      </div>

      {blockingCodes.length > 0 && (
        <div className="p-4 bg-red-50 text-red-800 rounded-lg border border-red-200">
          <p className="font-semibold text-sm mb-2">Blocking Codes Prevent Release:</p>
          <ul className="list-disc pl-5 text-sm space-y-1">
            {blockingCodes.map(code => (
              <li key={code} className="font-mono">{code}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        disabled={!canRelease}
        className="mt-4 min-h-11 px-6 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-sm hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Release to Katana
      </button>
    </div>
  );
}

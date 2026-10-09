import { BomMaterialRow } from "@/app/admin/factory-bom/BomMaterialRow";
import type { AirlockSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import type { FactoryProductRow } from "@/server/factory-bom/list-factory-products";
import type { DraftBomLine } from "@/app/admin/factory-bom/actions";
import { calculateFreight } from "@/lib/sketchup-cutlist/derived-heuristics";

export function Step2Materials({
  snapshot,
  products,
}: {
  snapshot: AirlockSnapshot;
  products: FactoryProductRow[];
}) {
  const geomSnap = snapshot.cadUpload?.geometry_snapshot as {
    hygiene?: string;
    globalAabb?: { min: [number, number, number]; max: [number, number, number] } | null;
    aabb?: { min: [number, number, number]; max: [number, number, number] } | null;
    derived?: {
      argon?: { cubicFeet?: number };
      sand?: { pounds?: number };
      weight?: { aluminumLbs?: number };
      freight?: {
        skidBoardFt?: number;
        strapFt?: number;
        shrinkSqft?: number;
        grossFreightLbs?: number;
      };
    } | null;
  } | null;
  const isGeomHygiene = Boolean(snapshot.cadUpload?.error_message?.startsWith("GEOM_HYGIENE"));
  const isDraftReady = snapshot.cadUpload?.status === "draft_ready";
  const hasGeometryProposal = snapshot.lines.some((line) => line.source === "sketchup_geometry");

  const rootLines = snapshot.lines.filter(l => l.parent_sku === snapshot.rootSku);

  // We map them to DraftBomLine to feed BomMaterialRow for presentation
  const draftLines: DraftBomLine[] = rootLines.map(l => {
    const p = products.find(prod => prod.sku === l.child_sku);
    return {
      id: l.id,
      parentSku: l.parent_sku,
      childSku: l.child_sku,
      childName: p?.name || "Unknown Component",
      childItemType: (p as any)?.itemType || "raw_material", // Approximation for presentation
      quantity: String(Number(l.quantity)),
      scrapFactor: String(Number(l.scrap_factor)),
      unitOfMeasure: l.unit_of_measure,
      status: l.status as any,
      source: l.source,
      notes: l.notes,
      cutList: Array.isArray(l.cut_list) ? (l.cut_list as any) : [],
    };
  });

  const derived = geomSnap?.derived ?? null;
  const estWeightLbs = Number(derived?.weight?.aluminumLbs ?? 0);
  const argonCf = Number(derived?.argon?.cubicFeet ?? 0);
  const sandLb = Number(derived?.sand?.pounds ?? 0);
  const freight = derived?.freight
    ? {
        skidBoardFt: Number(derived.freight.skidBoardFt ?? 0),
        strapFt: Number(derived.freight.strapFt ?? 0),
        shrinkSqft: Number(derived.freight.shrinkSqft ?? 0),
        grossFreightLbs: Number(derived.freight.grossFreightLbs ?? 0),
      }
    : calculateFreight(geomSnap?.globalAabb ?? geomSnap?.aabb ?? null, estWeightLbs);
  const visibleLines = isGeomHygiene ? [] : draftLines;

  return (
    <div className="flex flex-col gap-6">
      {/* Proposal Banner */}
      {isDraftReady && hasGeometryProposal && !isGeomHygiene && (
        <div className="p-4 bg-green-50 text-green-800 rounded-lg border border-green-200">
          <p className="font-semibold">Proposed from SketchUp geometry. Verify each cut.</p>
        </div>
      )}
      {isGeomHygiene && (
        <div className="p-4 bg-yellow-50 text-yellow-800 rounded-lg border border-yellow-200">
          <p className="font-semibold">Component names do not match the lengthless standard FRM-ALUM-2X2. Enter the cut list manually.</p>
        </div>
      )}

      {/* Cut Cards */}
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-bold text-slate-800">Cut Cards</h3>
        {visibleLines.length === 0 ? (
          <p className="text-sm text-slate-500">No materials drafted.</p>
        ) : (
          visibleLines.map(line => (
            <BomMaterialRow
              key={line.id}
              line={line}
              isPending={false}
              onSave={() => {}}
              onRemove={() => {}}
            />
          ))
        )}
      </div>

      {/* Consumables and Freight */}
      <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-6">
        <div>
          <h4 className="font-semibold text-slate-700 mb-2">Consumables</h4>
          <ul className="text-sm text-slate-600 space-y-1">
            <li>Argon: {argonCf} cf</li>
            <li>Sand: {sandLb} lb</li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold text-slate-700 mb-2">Freight Packaging</h4>
          <ul className="text-sm text-slate-600 space-y-1">
            <li>Skid Lumber: {freight.skidBoardFt} board ft</li>
            <li>PET Strap: {freight.strapFt} ft</li>
            <li>Shrink: {freight.shrinkSqft} sqft</li>
          </ul>
        </div>
      </div>
      
      {/* Weights */}
      <div className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-6">
        <div>
          <h4 className="font-semibold text-slate-700 mb-2">Estimated Volume Weight</h4>
          <p className="text-sm text-slate-600">est_weight_lbs: {estWeightLbs.toFixed(2)} lbs (Aluminum volume method)</p>
        </div>
        <div>
          <h4 className="font-semibold text-slate-700 mb-2">Gross Freight Weight</h4>
          <p className="text-sm text-slate-600">gross_freight_weight_lbs: {freight.grossFreightLbs.toFixed(2)} lbs (Net aluminum + skid lumber)</p>
        </div>
      </div>
    </div>
  );
}

"use client";

import React from "react";
import { BomMaterialRow } from "@/app/admin/factory-bom/BomMaterialRow";
import type { IntakeSnapshot } from "@/server/factory-bom/load-airlock-snapshot";
import type { FactoryProductRow } from "@/server/factory-bom/list-factory-products";
import type { DraftBomLine } from "@/app/admin/factory-bom/actions";
import { calculateFreight } from "@/lib/sketchup-cutlist/derived-heuristics";
import { emeraldBanner, ticket } from "@/app/admin/factory-bom/factory-bom-ui";

type ProductMeta = FactoryProductRow & {
  itemType?: string;
  category?: string;
};

interface Step2MaterialsProps {
  snapshot: IntakeSnapshot;
  products: ProductMeta[];
  readOnly?: boolean;
}

export function Step2Materials({ snapshot, products, readOnly = false }: Step2MaterialsProps) {
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

  const rootLines = snapshot.lines.filter((l) => l.parent_sku === snapshot.rootSku);

  // We map them to DraftBomLine to feed BomMaterialRow for presentation
  const draftLines: DraftBomLine[] = rootLines.map((l) => {
    const p = products.find((prod) => prod.sku === l.child_sku);
    return {
      id: l.id,
      parentSku: l.parent_sku,
      childSku: l.child_sku,
      childName: p?.name || "Unknown Component",
      childItemType:
        (p?.itemType as "raw_material" | "sub_assembly" | "finished_good" | "service") ||
        "raw_material",
      quantity: String(Number(l.quantity)),
      scrapFactor: String(Number(l.scrap_factor)),
      unitOfMeasure: l.unit_of_measure,
      status: (l.status === "factory_approved"
        ? "factory_approved"
        : l.status === "edited"
        ? "edited"
        : "draft_pending_review") as DraftBomLine["status"],
      source: l.source,
      notes: l.notes,
      cutList: Array.isArray(l.cut_list) ? (l.cut_list as DraftBomLine["cutList"]) : [],
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
    <div
      className={`flex flex-col gap-6 ${readOnly ? "pointer-events-none select-none" : ""}`}
      aria-disabled={readOnly || undefined}
    >
      {/* Proposal Banner */}
      {isDraftReady && hasGeometryProposal && !isGeomHygiene && (
        <div className={emeraldBanner}>
          <p className="font-semibold">Proposed from SketchUp geometry. Verify each cut.</p>
        </div>
      )}
      {isGeomHygiene && (
        <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
          <p className="font-semibold">
            Component names do not match the lengthless standard FRM-ALUM-2X2. Enter the cut list manually.
          </p>
        </div>
      )}

      {/* Cut Cards */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">Cut Cards</h3>
        {visibleLines.length === 0 ? (
          <p className={`text-xs text-stone-500 ${ticket}`}>No materials drafted.</p>
        ) : (
          visibleLines.map((line) => (
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-stone-200/80 dark:border-stone-800/80 pt-6">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Consumables
          </h4>
          <ul className={`${ticket} space-y-1`}>
            <li>Argon: {argonCf} cf</li>
            <li>Sand: {sandLb} lb</li>
          </ul>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Freight Packaging
          </h4>
          <ul className={`${ticket} space-y-1`}>
            <li>Skid Lumber: {freight.skidBoardFt} board ft</li>
            <li>PET Strap: {freight.strapFt} ft</li>
            <li>Shrink: {freight.shrinkSqft} sqft</li>
          </ul>
        </div>
      </div>

      {/* Weights */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-stone-200/80 dark:border-stone-800/80 pt-6">
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Estimated Volume Weight
          </h4>
          <p className={ticket}>
            Estimated weight: {estWeightLbs.toFixed(2)} lbs (Aluminum volume method)
          </p>
        </div>
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
            Gross Freight Weight
          </h4>
          <p className={ticket}>
            Gross freight weight: {freight.grossFreightLbs.toFixed(2)} lbs (Net aluminum + skid lumber)
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Locked Katana Resource catalog + Standard Tracks.
 * Binding: docs/MDM_MASTER_BLUEPRINT.md §5B Tier 1.1 /
 * docs/FACTORY_FLOOR_TOPOLOGY.md (owner parallel tracks)
 *
 * Parallel factory topology (2026-09 Owner lock):
 *   1st floor metal: Metal Cutting → FAB POD A/B/C → Sandblast → Powder + Cure
 *   2nd floor upholstery: Fabric Cutting → Sewing → Stuffing → Upholstery QC
 *   Convergence: Final Assembly (QC + Pack) on FIN-*
 *   Stone: Dekton Fabrication (parallel specialty cell)
 *
 * SMV minutes: src/lib/factory-routing/smv-baselines.ts
 * Resources are physical workstations — never invent action-named oven duplicates.
 */

import {
  cushionSmvSplit,
  dektonFabricationSmvMin,
  fabPodRunSmvMin,
  metalCuttingSmvMin,
  powderActiveLaborSmvMin,
  powderCurePassiveMin,
  RESEARCH_SMV,
} from "./smv-baselines";

/** Metal / finishing physical cells (1st floor + convergence shared cells). */
export const METAL_KATANA_RESOURCES = [
  "Metal Cutting",
  "FAB POD A",
  "FAB POD B",
  "FAB POD C",
  "Sandblasting",
  "Powder Coating Booth",
  "Curing Oven",
  "Quality Control",
  "Assembly & Packaging",
] as const;

/** Soft-goods / cushion cells (2nd floor). */
export const FABRIC_KATANA_RESOURCES = [
  "Fabric Cutting",
  "Fabric Sewing",
  "Cushion Stuffing",
] as const;

/** Stone / Dekton cells (specialty pod). */
export const DEKTON_KATANA_RESOURCES = ["Dekton Fabrication"] as const;

export const KATANA_RESOURCES = [
  ...METAL_KATANA_RESOURCES,
  ...FABRIC_KATANA_RESOURCES,
  ...DEKTON_KATANA_RESOURCES,
] as const;

export type KatanaResource = (typeof KATANA_RESOURCES)[number];

/**
 * When Hub `work_center` is a Resource, Katana `operation_name` may differ
 * (shop-floor verb vs physical cell). Default = resource string.
 */
export const RESOURCE_OPERATION_NAMES: Readonly<
  Partial<Record<KatanaResource, string>>
> = {
  "FAB POD A": "Fabrication & Welding",
  "FAB POD B": "Fabrication & Welding",
  "FAB POD C": "Fabrication & Welding",
  "Metal Cutting": "Cold Saw Fabrication",
  "Dekton Fabrication": "Dekton Fabrication",
};

/**
 * Legacy action / shop-floor / pre-topology strings → locked physical Resource.
 * Apply on read/sync so historical draft rows do not mint duplicate Katana cells.
 *
 * Note: `Metal Cutting` is a first-class feeder cell again (not aliased to fab pod).
 */
export const LEGACY_RESOURCE_ALIASES: Readonly<Record<string, KatanaResource>> =
  {
    // Metal fab pods (weld / grind / tack)
    "Building & Welding": "FAB POD A",
    "Fabrication & Welding": "FAB POD A",
    "Welding Station": "FAB POD A",
    "Material Handling": "Metal Cutting",
    "Metal Grinding": "FAB POD A",
    "Grinding Station": "FAB POD A",
    // Finishing
    "Metal Sandblasting": "Sandblasting",
    "Metal Powder Coating": "Powder Coating Booth",
    "Quality Check": "Quality Control",
    "Upholstery QC": "Quality Control",
    // Stone
    "Dekton Cutting": "Dekton Fabrication",
    "Dekton Grinding": "Dekton Fabrication",
    "Dekton Polishing": "Dekton Fabrication",
    "Stone Fabrication": "Dekton Fabrication",
  };

export type StandardTrackId =
  | "aluminum_frame"
  | "cushion"
  | "final_assembly"
  | "dekton_top";

export type TrackStep = {
  /**
   * Floor-facing label stored on draft `notes` (UI hint).
   * Katana `operation_name` comes from {@link resolveKatanaOperationName}.
   */
  floorLabel: string;
  sequence: number;
  /** Katana `resource_name` / Hub `work_center`. */
  resource: KatanaResource;
  setupTimeMins: number;
  runTimeMins: number;
};

const CUSHION_SMV = cushionSmvSplit();

/**
 * Standard Tracks — Owner parallel topology + research SMVs.
 * Sequences sparse (10…) so managers can insert manual steps.
 * Default fab pod assignment is A; B/C exist for capacity routing.
 */
export const STANDARD_TRACKS: Record<StandardTrackId, TrackStep[]> = {
  /** 1st-floor metal track (ASM-*-FRAME). Convergence pack lives on final_assembly. */
  aluminum_frame: [
    {
      floorLabel: "Cold Saw Fabrication",
      sequence: 10,
      resource: "Metal Cutting",
      setupTimeMins: 0,
      runTimeMins: metalCuttingSmvMin(),
    },
    {
      floorLabel: "Fabrication & Welding",
      sequence: 20,
      resource: "FAB POD A",
      // SMED fixture is inside weld SMV; keep setup 0 on the process row
      setupTimeMins: 0,
      runTimeMins: fabPodRunSmvMin(),
    },
    {
      floorLabel: "Sandblast",
      sequence: 30,
      resource: "Sandblasting",
      // Out of IE study — retain prior placeholder until time-studied
      setupTimeMins: 10,
      runTimeMins: 20,
    },
    {
      floorLabel: "Powder Coat (active labor)",
      sequence: 40,
      resource: "Powder Coating Booth",
      setupTimeMins: 0,
      runTimeMins: powderActiveLaborSmvMin(),
    },
    {
      floorLabel: "Cure (passive oven)",
      sequence: 50,
      resource: "Curing Oven",
      setupTimeMins: 0,
      runTimeMins: powderCurePassiveMin(),
    },
  ],

  /** 2nd-floor upholstery track (ASM-*-CUSH) — parallel to metal. */
  cushion: [
    {
      floorLabel: "Fabric Cut",
      sequence: 10,
      resource: "Fabric Cutting",
      setupTimeMins: 0,
      runTimeMins: CUSHION_SMV.fabricCuttingMin,
    },
    {
      floorLabel: "Sew",
      sequence: 20,
      resource: "Fabric Sewing",
      setupTimeMins: 0,
      runTimeMins: CUSHION_SMV.fabricSewingMin,
    },
    {
      floorLabel: "Stuff",
      sequence: 30,
      resource: "Cushion Stuffing",
      setupTimeMins: 0,
      runTimeMins: CUSHION_SMV.cushionStuffingMin,
    },
    {
      floorLabel: "Upholstery QC & Transfer",
      sequence: 40,
      resource: "Quality Control",
      // Placeholder — not in Build_Time_Estimates.md
      setupTimeMins: 0,
      runTimeMins: 8,
    },
  ],

  /** Convergence on FIN-* — marry frame + cushion, hardware, pack. */
  final_assembly: [
    {
      floorLabel: "Final QC",
      sequence: 10,
      resource: "Quality Control",
      setupTimeMins: 0,
      runTimeMins: 8,
    },
    {
      floorLabel: "Assemble & Pack",
      sequence: 20,
      resource: "Assembly & Packaging",
      setupTimeMins: 5,
      runTimeMins: 15,
    },
  ],

  /** Specialty stone track (Dekton tops / STN parents as producible SAs). */
  dekton_top: [
    {
      floorLabel: "Dekton Fabrication",
      sequence: 10,
      resource: "Dekton Fabrication",
      setupTimeMins: 0,
      runTimeMins: dektonFabricationSmvMin(),
    },
  ],
};

/** Re-export research lock for track consumers / docs. */
export { RESEARCH_SMV };

export function isKatanaResource(value: string): value is KatanaResource {
  return (KATANA_RESOURCES as readonly string[]).includes(value);
}

/** Map legacy strings onto locked Resources; pass through when already canonical. */
export function normalizeKatanaResource(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const aliased = LEGACY_RESOURCE_ALIASES[trimmed];
  if (aliased) return aliased;
  return trimmed;
}

/**
 * Katana `operation_name` for a (possibly legacy) work-center string.
 * Setup rows should append " Setup" in the writer.
 */
export function resolveKatanaOperationName(workCenter: string): string {
  const resource = normalizeKatanaResource(workCenter);
  if (isKatanaResource(resource)) {
    return RESOURCE_OPERATION_NAMES[resource] ?? resource;
  }
  return resource;
}

export function getStandardTrack(trackId: StandardTrackId): TrackStep[] {
  return STANDARD_TRACKS[trackId];
}

export function isStandardTrackId(value: string): value is StandardTrackId {
  return Object.prototype.hasOwnProperty.call(STANDARD_TRACKS, value);
}

/** Bucket for collection-bom / secondary extract SKU targeting. */
export function resourceLane(
  resource: string,
): "frame" | "cushion" | "fg" | "dekton" | "unknown" {
  const normalized = normalizeKatanaResource(resource);
  if (
    (FABRIC_KATANA_RESOURCES as readonly string[]).includes(normalized)
  ) {
    return "cushion";
  }
  if (
    (DEKTON_KATANA_RESOURCES as readonly string[]).includes(normalized)
  ) {
    return "dekton";
  }
  if (
    normalized === "Quality Control" ||
    normalized === "Assembly & Packaging"
  ) {
    return "fg";
  }
  if ((METAL_KATANA_RESOURCES as readonly string[]).includes(normalized)) {
    return "frame";
  }
  return "unknown";
}

import { describe, expect, it } from "vitest";
import {
  getStandardTrack,
  isKatanaResource,
  isStandardTrackId,
  KATANA_RESOURCES,
  LEGACY_RESOURCE_ALIASES,
  normalizeKatanaResource,
  resolveKatanaOperationName,
  resourceLane,
  STANDARD_TRACKS,
} from "@/lib/factory-routing/resources";
import { RESEARCH_SMV } from "@/lib/factory-routing/smv-baselines";

describe("factory-routing resources (parallel floor topology)", () => {
  it("exports locked metal + fabric + dekton catalog with feeder + fab pods", () => {
    expect(KATANA_RESOURCES).toContain("Metal Cutting");
    expect(KATANA_RESOURCES).toContain("FAB POD A");
    expect(KATANA_RESOURCES).toContain("FAB POD B");
    expect(KATANA_RESOURCES).toContain("FAB POD C");
    expect(KATANA_RESOURCES).toContain("Powder Coating Booth");
    expect(KATANA_RESOURCES).toContain("Curing Oven");
    expect(KATANA_RESOURCES).toContain("Quality Control");
    expect(KATANA_RESOURCES).toContain("Fabric Sewing");
    expect(KATANA_RESOURCES).toContain("Dekton Fabrication");
    expect(KATANA_RESOURCES).not.toContain("Grinding Station");
    expect(KATANA_RESOURCES).not.toContain("Welding Station");
    expect(KATANA_RESOURCES).not.toContain("Dekton Cutting");
  });

  it("rejects action-named oven duplicates that would split capacity", () => {
    expect(isKatanaResource("Heat Primer")).toBe(false);
    expect(isKatanaResource("Heat Powder")).toBe(false);
    expect(isKatanaResource("Building & Welding")).toBe(false);
    expect(isKatanaResource("Quality Check")).toBe(false);
    expect(isKatanaResource("Curing Oven")).toBe(true);
    expect(isKatanaResource("Metal Cutting")).toBe(true);
  });

  it("normalizes legacy Resource strings onto physical cells", () => {
    expect(normalizeKatanaResource("Building & Welding")).toBe("FAB POD A");
    expect(normalizeKatanaResource("Fabrication & Welding")).toBe("FAB POD A");
    expect(normalizeKatanaResource("Welding Station")).toBe("FAB POD A");
    expect(normalizeKatanaResource("Metal Grinding")).toBe("FAB POD A");
    expect(normalizeKatanaResource("Grinding Station")).toBe("FAB POD A");
    expect(normalizeKatanaResource("Metal Cutting")).toBe("Metal Cutting");
    expect(normalizeKatanaResource("Material Handling")).toBe("Metal Cutting");
    expect(normalizeKatanaResource("Metal Powder Coating")).toBe(
      "Powder Coating Booth",
    );
    expect(normalizeKatanaResource("Quality Check")).toBe("Quality Control");
    expect(normalizeKatanaResource("Upholstery QC")).toBe("Quality Control");
    expect(normalizeKatanaResource("Dekton Cutting")).toBe("Dekton Fabrication");
    expect(normalizeKatanaResource("FAB POD A")).toBe("FAB POD A");
    for (const [legacy, canonical] of Object.entries(LEGACY_RESOURCE_ALIASES)) {
      expect(normalizeKatanaResource(legacy)).toBe(canonical);
      expect(isKatanaResource(canonical)).toBe(true);
    }
  });

  it("resolves operation_name separately from resource_name for fab pods", () => {
    expect(resolveKatanaOperationName("FAB POD A")).toBe(
      "Fabrication & Welding",
    );
    expect(resolveKatanaOperationName("FAB POD B")).toBe(
      "Fabrication & Welding",
    );
    expect(resolveKatanaOperationName("Building & Welding")).toBe(
      "Fabrication & Welding",
    );
    expect(resolveKatanaOperationName("Metal Cutting")).toBe(
      "Cold Saw Fabrication",
    );
    expect(resolveKatanaOperationName("Dekton Cutting")).toBe(
      "Dekton Fabrication",
    );
    expect(resolveKatanaOperationName("Sandblasting")).toBe("Sandblasting");
  });

  it("aluminum_frame is 1st-floor metal sequence with research SMVs", () => {
    const track = getStandardTrack("aluminum_frame");
    expect(track.map((s) => s.resource)).toEqual([
      "Metal Cutting",
      "FAB POD A",
      "Sandblasting",
      "Powder Coating Booth",
      "Curing Oven",
    ]);
    expect(track[0]?.runTimeMins).toBe(RESEARCH_SMV.metalCuttingClubChairMin);
    expect(track[1]?.runTimeMins).toBe(RESEARCH_SMV.fabPodClubChairMin);
    expect(track[3]?.runTimeMins).toBe(RESEARCH_SMV.powderActiveLaborMin);
    expect(track[4]?.runTimeMins).toBe(RESEARCH_SMV.powderCurePassiveMin);
    expect(track.some((s) => s.resource.includes("Grind"))).toBe(false);
    expect(
      track.some((s) => s.resource === "Assembly & Packaging"),
    ).toBe(false);
    for (const step of track) {
      expect(isKatanaResource(step.resource)).toBe(true);
    }
  });

  it("cushion is 2nd-floor upholstery sequence with SAM split", () => {
    const track = getStandardTrack("cushion");
    expect(track.map((s) => s.resource)).toEqual([
      "Fabric Cutting",
      "Fabric Sewing",
      "Cushion Stuffing",
      "Quality Control",
    ]);
    expect(track[0]?.runTimeMins).toBe(RESEARCH_SMV.cushionFabricCuttingMin);
    expect(track[1]?.runTimeMins).toBe(RESEARCH_SMV.cushionFabricSewingMin);
    expect(track[2]?.runTimeMins).toBe(RESEARCH_SMV.cushionStuffingMin);
    expect(track[3]?.floorLabel).toMatch(/Upholstery QC/i);
  });

  it("final_assembly converges FIN-* at QC + pack", () => {
    const track = getStandardTrack("final_assembly");
    expect(track.map((s) => s.resource)).toEqual([
      "Quality Control",
      "Assembly & Packaging",
    ]);
  });

  it("dekton_top is a single stone cell at 34.5", () => {
    const track = getStandardTrack("dekton_top");
    expect(track).toHaveLength(1);
    expect(track[0]?.resource).toBe("Dekton Fabrication");
    expect(track[0]?.runTimeMins).toBe(RESEARCH_SMV.dektonFabricationMin);
  });

  it("exposes all four Standard Track ids", () => {
    expect(Object.keys(STANDARD_TRACKS).sort()).toEqual([
      "aluminum_frame",
      "cushion",
      "dekton_top",
      "final_assembly",
    ]);
    expect(isStandardTrackId("final_assembly")).toBe(true);
    expect(isStandardTrackId("nope")).toBe(false);
  });

  it("resourceLane buckets frame / cushion / fg / dekton", () => {
    expect(resourceLane("Metal Cutting")).toBe("frame");
    expect(resourceLane("FAB POD A")).toBe("frame");
    expect(resourceLane("Building & Welding")).toBe("frame");
    expect(resourceLane("Fabric Sewing")).toBe("cushion");
    expect(resourceLane("Quality Control")).toBe("fg");
    expect(resourceLane("Assembly & Packaging")).toBe("fg");
    expect(resourceLane("Dekton Fabrication")).toBe("dekton");
    expect(resourceLane("Dekton Cutting")).toBe("dekton");
  });
});

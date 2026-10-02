import { describe, expect, it } from "vitest";
import {
  classifyCostGapFamily,
  classifyKatanaCostGap,
  decideMissingOpsExport,
  planMissingOpsExport,
  summarizeCostGaps,
  summarizeMissingOpsPlan,
} from "@/lib/katana-cost-gaps";
import { getStandardTrack } from "@/lib/factory-routing/resources";
import { expandHubOperationsToKatanaCsvRows } from "@/lib/katana-operations-csv";

describe("classifyCostGapFamily", () => {
  it("buckets FIN / SA-ASM FRAME / CUSH", () => {
    expect(classifyCostGapFamily("FIN-BRV-SOF-72X34")).toBe("FIN");
    expect(classifyCostGapFamily("FIN-OCN-CLB-CHA-34X38-LS-BE-N")).toBe("FIN");
    expect(classifyCostGapFamily("SA-BRV-CLB-CHA-34X34-FRAME")).toBe("FRAME");
    expect(classifyCostGapFamily("ASM-BRV-ARM-SOF-72X34-FRAME")).toBe("FRAME");
    expect(classifyCostGapFamily("SA-BRO-C-72X34-LS-FRAME")).toBe("FRAME");
    expect(classifyCostGapFamily("SA-BRV-CLB-CHA-34X34-CUSH")).toBe("CUSH");
    expect(classifyCostGapFamily("ASM-OCN-SOF-72X38-CUSHION")).toBe("CUSH");
  });

  it("leaves RM, colorways, and unmatched SKUs out of scope", () => {
    expect(classifyCostGapFamily("RM-PWD-GENERIC")).toBe("other");
    expect(classifyCostGapFamily("PWD-BLACK")).toBe("other");
    expect(classifyCostGapFamily("FAB-SUN-NAT")).toBe("other");
    expect(classifyCostGapFamily("SA-BRV-ARM")).toBe("other");
    expect(classifyCostGapFamily("CUT-BRV-LEG-01")).toBe("other");
  });
});

describe("classifyKatanaCostGap", () => {
  it("marks FIN with leftover labor and no ingredients as ops_only", () => {
    const row = classifyKatanaCostGap({
      sku: "FIN-OCN-SOF-72X38",
      recipeRowCount: 0,
      operationRowCount: 2,
    });
    expect(row.family).toBe("FIN");
    expect(row.gapClass).toBe("ops_only");
    expect(row.opsPresence).toBe("has_ops");
    expect(row.trackId).toBe("final_assembly");
  });

  it("marks FIN with no recipe and no ops as empty ($0 class)", () => {
    const row = classifyKatanaCostGap({
      sku: "FIN-BRV-SOF-72X34",
      recipeRowCount: 0,
      operationRowCount: 0,
    });
    expect(row.gapClass).toBe("empty");
    expect(row.opsPresence).toBe("missing_ops");
    expect(row.trackId).toBe("final_assembly");
  });

  it("marks FIN with BOM as ok_recipe regardless of ops", () => {
    expect(
      classifyKatanaCostGap({
        sku: "FIN-OCN-MIN-LOV",
        recipeRowCount: 2,
        operationRowCount: 2,
      }).gapClass,
    ).toBe("ok_recipe");
  });

  it("marks FRAME with RM and blank operations as frame_rm_no_ops", () => {
    const row = classifyKatanaCostGap({
      sku: "SA-BRV-CLB-CHA-34X34-FRAME",
      recipeRowCount: 6,
      operationRowCount: 0,
    });
    expect(row.family).toBe("FRAME");
    expect(row.gapClass).toBe("frame_rm_no_ops");
    expect(row.opsPresence).toBe("missing_ops");
    expect(row.trackId).toBe("aluminum_frame");
  });

  it("marks CUSH with no fabric/foam as cush_no_rm", () => {
    const row = classifyKatanaCostGap({
      sku: "SA-BRV-CLB-CHA-34X34-CUSH",
      recipeRowCount: 0,
      operationRowCount: 0,
    });
    expect(row.gapClass).toBe("cush_no_rm");
    expect(row.opsPresence).toBe("missing_ops");
    expect(row.trackId).toBe("cushion");
  });

  it("summarizes FIN ops-only vs empty vs BOM and FRAME/CUSH missing_ops", () => {
    const rows = [
      classifyKatanaCostGap({
        sku: "FIN-A",
        recipeRowCount: 0,
        operationRowCount: 2,
      }),
      classifyKatanaCostGap({
        sku: "FIN-B",
        recipeRowCount: 0,
        operationRowCount: 0,
      }),
      classifyKatanaCostGap({
        sku: "FIN-C",
        recipeRowCount: 1,
        operationRowCount: 2,
      }),
      classifyKatanaCostGap({
        sku: "SA-X-FRAME",
        recipeRowCount: 4,
        operationRowCount: 0,
      }),
      classifyKatanaCostGap({
        sku: "SA-X-CUSH",
        recipeRowCount: 0,
        operationRowCount: 0,
      }),
      classifyKatanaCostGap({
        sku: "RM-PWD-GENERIC",
        recipeRowCount: 0,
        operationRowCount: 0,
      }),
    ];
    const sum = summarizeCostGaps(rows);
    expect(sum.finOpsOnly).toBe(1);
    expect(sum.finEmpty).toBe(1);
    expect(sum.finOkRecipe).toBe(1);
    expect(sum.frameRmNoOps).toBe(1);
    expect(sum.frameMissingOps).toBe(1);
    expect(sum.cushNoRm).toBe(1);
    expect(sum.cushMissingOps).toBe(1);
    expect(sum.inScope).toBe(5);
  });
});

describe("planMissingOpsExport (File 4 labor injection)", () => {
  it("emits aluminum_frame for FRAME SKUs with zero ops, including Metal Cutting + Curing Oven", () => {
    const decision = decideMissingOpsExport({
      sku: "SA-BRV-CLB-CHA-34X34-FRAME",
      name: "Bravada Club Chair Frame",
      operationRowCount: 0,
    });
    expect(decision.include).toBe(true);
    expect(decision.trackId).toBe("aluminum_frame");
    expect(decision.reason).toBe("missing_ops_aluminum_frame");

    const { hubOps } = planMissingOpsExport([
      {
        sku: "SA-BRV-CLB-CHA-34X34-FRAME",
        name: "Bravada Club Chair Frame",
        operationRowCount: 0,
      },
    ]);
    expect(hubOps.map((op) => op.workCenter)).toEqual(
      getStandardTrack("aluminum_frame").map((s) => s.resource),
    );
    const csv = expandHubOperationsToKatanaCsvRows(hubOps);
    const resources = csv.map((r) => r.resource);
    expect(resources).toContain("Metal Cutting");
    expect(resources).toContain("FAB POD A");
    expect(resources).toContain("Sandblasting");
    expect(resources).toContain("Powder Coating Booth");
    expect(resources).toContain("Curing Oven");
    expect(csv.every((r) => r.productSku === "SA-BRV-CLB-CHA-34X34-FRAME")).toBe(
      true,
    );
  });

  it("skips FIN SKUs that already have operation rows (ops-only $13.07 class)", () => {
    const decision = decideMissingOpsExport({
      sku: "FIN-OCN-SOF-72X38",
      operationRowCount: 2,
    });
    expect(decision.include).toBe(false);
    expect(decision.reason).toBe("skip_existing_ops");
    expect(decision.trackId).toBe("final_assembly");

    const { hubOps, plan } = planMissingOpsExport([
      { sku: "FIN-OCN-SOF-72X38", operationRowCount: 2 },
      { sku: "FIN-OCN-COF-TAB-42X28", operationRowCount: 1 },
    ]);
    expect(hubOps).toHaveLength(0);
    expect(plan.every((r) => r.reason === "skip_existing_ops")).toBe(true);
  });

  it("emits final_assembly only for empty FIN SKUs with zero ops", () => {
    const decision = decideMissingOpsExport({
      sku: "FIN-BRV-SOF-72X34",
      operationRowCount: 0,
    });
    expect(decision.include).toBe(true);
    expect(decision.trackId).toBe("final_assembly");
    expect(decision.reason).toBe("missing_ops_final_assembly");

    const { hubOps } = planMissingOpsExport([
      { sku: "FIN-BRV-SOF-72X34", operationRowCount: 0 },
    ]);
    expect(hubOps.map((op) => op.workCenter)).toEqual([
      "Quality Control",
      "Assembly & Packaging",
    ]);
    const csv = expandHubOperationsToKatanaCsvRows(hubOps);
    expect(csv.every((r) => r.productSku === "FIN-BRV-SOF-72X34")).toBe(true);
    expect(csv.map((r) => r.resource)).not.toContain("Metal Cutting");
    expect(csv.map((r) => r.resource)).not.toContain("Curing Oven");
  });

  it("emits cushion track for CUSH SKUs with zero ops", () => {
    const decision = decideMissingOpsExport({
      sku: "SA-BRV-CLB-CHA-34X34-CUSH",
      operationRowCount: 0,
    });
    expect(decision.include).toBe(true);
    expect(decision.trackId).toBe("cushion");
    const { hubOps } = planMissingOpsExport([
      { sku: "SA-BRV-CLB-CHA-34X34-CUSH", operationRowCount: 0 },
    ]);
    expect(hubOps.map((op) => op.workCenter)).toEqual(
      getStandardTrack("cushion").map((s) => s.resource),
    );
  });

  it("does not mix a $13.07 FIN into File 4 when a sibling empty FIN is included", () => {
    const { plan, hubOps } = planMissingOpsExport([
      { sku: "FIN-OCN-SOF-72X38", operationRowCount: 2 },
      { sku: "FIN-BRV-SOF-72X34", operationRowCount: 0 },
      { sku: "SA-BRV-CLB-CHA-34X34-FRAME", operationRowCount: 0 },
      { sku: "RM-PWD-GENERIC", operationRowCount: 0 },
    ]);
    const included = plan.filter((r) => r.include).map((r) => r.sku);
    expect(included).toEqual([
      "FIN-BRV-SOF-72X34",
      "SA-BRV-CLB-CHA-34X34-FRAME",
    ]);
    expect(hubOps.some((op) => op.itemSku === "FIN-OCN-SOF-72X38")).toBe(false);
    expect(hubOps.some((op) => op.itemSku === "RM-PWD-GENERIC")).toBe(false);

    const sum = summarizeMissingOpsPlan(plan);
    expect(sum.include).toBe(2);
    expect(sum.skipExistingOps).toBe(1);
    expect(sum.skipOutOfScope).toBe(1);
    expect(sum.finalAssembly).toBe(1);
    expect(sum.aluminumFrame).toBe(1);
  });
});

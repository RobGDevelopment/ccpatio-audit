import { describe, expect, it } from "vitest";
import {
  expandHubOperationsToKatanaCsvRows,
  hubOperationToKatanaCsvRows,
  KATANA_OPERATIONS_CSV_HEADERS,
  minutesToHms,
  toKatanaOperationsCsv,
  trackStepsToHubOperations,
} from "@/lib/katana-operations-csv";
import { getStandardTrack } from "@/lib/factory-routing/resources";

describe("katana-operations-csv", () => {
  it("matches Advanced Manufacturing template headers exactly", () => {
    expect([...KATANA_OPERATIONS_CSV_HEADERS]).toEqual([
      "Product variant code / SKU (required)",
      "Product variant name",
      "Product operation name (required)",
      "Resource",
      "Type",
      "Cost parameter",
      "Hours",
      "Minutes",
      "Seconds",
    ]);
  });

  it("splits decimal minutes into H/M/S", () => {
    expect(minutesToHms(76.3)).toEqual({
      hours: 1,
      minutes: 16,
      seconds: 18,
    });
    expect(minutesToHms(13.8)).toEqual({
      hours: 0,
      minutes: 13,
      seconds: 48,
    });
    expect(minutesToHms(0)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
  });

  it("expands setup + process with Type Setup/Process and blank cost", () => {
    const rows = hubOperationToKatanaCsvRows({
      itemSku: "asm-brv-frame",
      productName: "Brava Frame",
      workCenter: "FAB POD A",
      sequence: 20,
      setupTimeMins: 3,
      runTimeMins: 76.3,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      productSku: "ASM-BRV-FRAME",
      productName: "Brava Frame",
      operationName: "Fabrication & Welding Setup",
      resource: "FAB POD A",
      costParameter: "",
      operationType: "Setup",
      hours: 0,
      minutes: 3,
      seconds: 0,
    });
    expect(rows[1]).toMatchObject({
      operationName: "Fabrication & Welding",
      operationType: "Process",
      costParameter: "",
      hours: 1,
      minutes: 16,
      seconds: 18,
    });
  });

  it("rejects unknown Resources after normalize", () => {
    expect(() =>
      hubOperationToKatanaCsvRows({
        itemSku: "ASM-X-FRAME",
        workCenter: "Heat Primer",
        sequence: 10,
        setupTimeMins: null,
        runTimeMins: 5,
      }),
    ).toThrow(/Unknown Katana Resource/);
  });

  it("normalizes legacy work centers onto locked Resources", () => {
    const rows = hubOperationToKatanaCsvRows({
      itemSku: "ASM-X-FRAME",
      workCenter: "Welding Station",
      sequence: 10,
      setupTimeMins: null,
      runTimeMins: 55.9,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resource).toBe("FAB POD A");
    expect(rows[0]?.operationName).toBe("Fabrication & Welding");
    expect(rows[0]?.operationType).toBe("Process");
  });

  it("emits aluminum_frame track CSV matching template column order", () => {
    const hubOps = trackStepsToHubOperations(
      "ASM-BRV-SOF-72X34-FRAME",
      getStandardTrack("aluminum_frame"),
      "Brava Sofa Frame",
    );
    const rows = expandHubOperationsToKatanaCsvRows(hubOps);
    expect(rows.map((r) => r.resource)).toEqual([
      "Metal Cutting",
      "FAB POD A",
      "Sandblasting",
      "Sandblasting",
      "Powder Coating Booth",
      "Curing Oven",
    ]);
    expect(rows.filter((r) => r.resource === "Sandblasting")).toHaveLength(2);
    expect(rows.every((r) => r.costParameter === "")).toBe(true);
    expect(rows.some((r) => r.operationType === "Setup")).toBe(true);
    expect(rows.every((r) => r.productName === "Brava Sofa Frame")).toBe(true);

    const csv = toKatanaOperationsCsv(rows);
    const headerLine = csv.split(/\r?\n/)[0];
    expect(headerLine).toBe(KATANA_OPERATIONS_CSV_HEADERS.join(","));
    expect(csv).toContain("ASM-BRV-SOF-72X34-FRAME");
    expect(csv).toContain("Cold Saw Fabrication");
    expect(csv).toContain(",Process,");
    expect(csv).toContain(",Setup,");
  });

  it("emits final_assembly and cushion tracks without unknown Resources", () => {
    for (const trackId of ["cushion", "final_assembly", "dekton_top"] as const) {
      const hubOps = trackStepsToHubOperations(
        trackId === "cushion"
          ? "ASM-X-CUSH"
          : trackId === "final_assembly"
            ? "FIN-X"
            : "ASM-X-DKT-TOP",
        getStandardTrack(trackId),
      );
      const rows = expandHubOperationsToKatanaCsvRows(hubOps);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.costParameter === "")).toBe(true);
    }
  });
});

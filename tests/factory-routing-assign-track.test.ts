import { describe, expect, it } from "vitest";
import {
  assignStandardTrack,
  resolveTrackId,
} from "@/lib/factory-routing/assign-track";

describe("assignStandardTrack", () => {
  it("maps FRAME SAs to aluminum_frame", () => {
    expect(resolveTrackId("ASM-BRV-SOF-72X34-FRAME")).toBe("aluminum_frame");
    expect(resolveTrackId("SA-OCN-CHR-34-FRAME")).toBe("aluminum_frame");
    expect(assignStandardTrack("ASM-X-FRAME").reason).toBe("frame_suffix");
  });

  it("maps CUSH SAs to cushion", () => {
    expect(resolveTrackId("ASM-BRV-SOF-72X34-CUSH")).toBe("cushion");
    expect(resolveTrackId("SA-OCN-CHR-34-CUSHION")).toBe("cushion");
    expect(assignStandardTrack("ASM-X-CUSH").reason).toBe("cush_suffix");
  });

  it("maps FIN-* to final_assembly (convergence)", () => {
    expect(resolveTrackId("FIN-BRV-SOF-72X34")).toBe("final_assembly");
    expect(resolveTrackId("FIN-OCN-TBL-72-DKT")).toBe("final_assembly");
    expect(assignStandardTrack("FIN-X").reason).toBe("fin_prefix");
  });

  it("maps producible Dekton / stone parents to dekton_top", () => {
    expect(resolveTrackId("ASM-OCN-TBL-72-DKT-TOP")).toBe("dekton_top");
    expect(resolveTrackId("SA-DIN-TOP-DKT")).toBe("dekton_top");
    expect(
      resolveTrackId({
        sku: "ASM-OCN-TBL-72-TOP",
        name: "Ocean table Dekton top",
      }),
    ).toBe("dekton_top");
  });

  it("returns null for raw materials, colorways, and CUT-*", () => {
    expect(resolveTrackId("RM-MET-2X2-TUBING")).toBeNull();
    expect(resolveTrackId("STN-DKT-BC1.2")).toBeNull();
    expect(resolveTrackId("DKT-GENERIC-SLAB")).toBeNull();
    expect(resolveTrackId("FAB-SUN-NAT")).toBeNull();
    expect(resolveTrackId("PWD-BLACK")).toBeNull();
    expect(resolveTrackId("MET-SQT20012")).toBeNull();
    expect(resolveTrackId("CUT-BRV-LEG-01")).toBeNull();
    expect(assignStandardTrack("CUT-X").reason).toBe("cut_identity");
    expect(assignStandardTrack("RM-X").reason).toBe("raw_material_prefix");
  });

  it("honors item_type raw_material / service even on FIN-looking strings", () => {
    expect(
      resolveTrackId({
        sku: "ASM-WEIRD-FRAME",
        itemType: "raw_material",
      }),
    ).toBeNull();
    expect(
      assignStandardTrack({ sku: "FIN-X", itemType: "service" }).reason,
    ).toBe("item_type_service");
  });

  it("returns null for unmatched producible SKUs", () => {
    expect(resolveTrackId("ASM-CUSTOM-MISC")).toBeNull();
    expect(assignStandardTrack("ASM-CUSTOM-MISC").reason).toBe(
      "unmatched_family",
    );
  });
});

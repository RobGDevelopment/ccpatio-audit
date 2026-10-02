import { describe, expect, it } from "vitest";
import {
  BLANK_TWIN_NAMES,
  HUB_REMINT_TARGETS,
  classifyMaterialForPurge,
  hubRemintSkuForName,
  isBlankTwinName,
  isHubRemintName,
  isWeldmentSku,
  normalizeMaterialName,
} from "@/lib/katana-material-purge";

describe("katana-material-purge classifier", () => {
  it("flags weldment prefixes SA-/ASM-/FIN-/CUT-", () => {
    expect(isWeldmentSku("SA-BRA-FRAME")).toBe(true);
    expect(isWeldmentSku("ASM-BRK-FRAME")).toBe(true);
    expect(isWeldmentSku("FIN-BRV-ARM")).toBe(true);
    expect(isWeldmentSku("CUT-LEG")).toBe(true);
    expect(isWeldmentSku("RM-MET-2X2-TUBING")).toBe(false);
    expect(isWeldmentSku("MET-TB22060")).toBe(false);
    expect(isWeldmentSku("FAB-ACT-ASH")).toBe(false);
  });

  it("deletes weldment material when product twin exists and not on BOM", () => {
    expect(
      classifyMaterialForPurge({
        sku: "SA-BRA-CL-S-FRAME",
        name: "Bravada",
        hasProductTwin: true,
        bomRowCount: 0,
      }),
    ).toEqual({
      action: "delete",
      reason: "weldment_with_product_twin",
    });
  });

  it("deletes orphaned weldment ghost (no product twin, not on BOM)", () => {
    expect(
      classifyMaterialForPurge({
        sku: "SA-ONLY-MATERIAL",
        name: "Orphan SA",
        hasProductTwin: false,
        bomRowCount: 0,
      }),
    ).toEqual({
      action: "delete",
      reason: "weldment_orphan_ghost",
    });
  });

  it("skips weldment still referenced by bom_rows (with or without twin)", () => {
    expect(
      classifyMaterialForPurge({
        sku: "SA-BRA-CL-S-FRAME",
        name: "Bravada",
        hasProductTwin: true,
        bomRowCount: 3,
      }),
    ).toEqual({
      action: "skip",
      reason: "weldment_on_bom",
    });
    expect(
      classifyMaterialForPurge({
        sku: "SA-ORPHAN-ON-BOM",
        name: "Legacy consume",
        hasProductTwin: false,
        bomRowCount: 2,
      }),
    ).toEqual({
      action: "skip",
      reason: "weldment_on_bom",
    });
  });

  it("protects the six Hub remint blanks (never delete)", () => {
    expect(HUB_REMINT_TARGETS).toHaveLength(6);
    for (const t of HUB_REMINT_TARGETS) {
      expect(isHubRemintName(t.name)).toBe(true);
      expect(hubRemintSkuForName(t.name)).toBe(t.sku);
      expect(
        classifyMaterialForPurge({
          sku: "",
          name: t.name,
          hasProductTwin: false,
          bomRowCount: 0,
        }),
      ).toEqual({
        action: "remint",
        reason: "blank_hub_remint_target",
      });
    }
  });

  it("deletes blank twins of already-reminted RM-*", () => {
    expect(BLANK_TWIN_NAMES.size).toBe(6);
    expect(isBlankTwinName("2x2 Tubing")).toBe(true);
    expect(isBlankTwinName("2x1 Tubing / 20'")).toBe(true);
    expect(
      classifyMaterialForPurge({
        sku: null,
        name: "2x2 Tubing",
        hasProductTwin: false,
        bomRowCount: 0,
      }),
    ).toEqual({
      action: "delete",
      reason: "blank_twin_of_reminted_rm",
    });
    expect(
      classifyMaterialForPurge({
        sku: "",
        name: "Fabric",
        hasProductTwin: false,
        bomRowCount: 0,
      }),
    ).toEqual({
      action: "delete",
      reason: "blank_twin_of_reminted_rm",
    });
  });

  it("deletes unused blank Metal ring", () => {
    expect(
      classifyMaterialForPurge({
        sku: "",
        name: "Metal ring",
        hasProductTwin: false,
        bomRowCount: 0,
      }),
    ).toEqual({
      action: "delete",
      reason: "blank_unused_metal_ring",
    });
  });

  it("skips unknown blanks and keeps MET-/FAB-/RM- catalog", () => {
    expect(
      classifyMaterialForPurge({
        sku: "",
        name: "Mystery Widget",
        hasProductTwin: false,
        bomRowCount: 0,
      }),
    ).toEqual({ action: "skip", reason: "blank_unknown" });

    expect(
      classifyMaterialForPurge({
        sku: "MET-TB22060",
        name: "2 X 2 X 16GA SQ TUBE",
        hasProductTwin: false,
        bomRowCount: 0,
      }),
    ).toEqual({ action: "skip", reason: "keep_catalog" });

    expect(
      classifyMaterialForPurge({
        sku: "FAB-ACT-ASH",
        name: "Sunbrella",
        hasProductTwin: false,
        bomRowCount: 0,
      }),
    ).toEqual({ action: "skip", reason: "keep_catalog" });

    expect(
      classifyMaterialForPurge({
        sku: "RM-MET-2X2-TUBING",
        name: "2x2 Tubing",
        hasProductTwin: false,
        bomRowCount: 0,
      }),
    ).toEqual({ action: "skip", reason: "keep_catalog" });
  });

  it("normalizes remint names case-insensitively", () => {
    expect(normalizeMaterialName("  flatbar ")).toBe("FLATBAR");
    expect(isHubRemintName("FLATBAR")).toBe(true);
    expect(hubRemintSkuForName("flatbar")).toBe("RM-MET-FLATBAR");
  });
});

import { describe, expect, it } from "vitest";
import {
  coerceHubItemType,
  isHubRawMaterialSku,
} from "@/lib/raw-material-sku";

describe("coerceHubItemType", () => {
  it("forces RM-* to raw_material regardless of drifted type", () => {
    expect(coerceHubItemType("RM-MET-2X2-TUBING", "finished_good")).toBe(
      "raw_material",
    );
    expect(coerceHubItemType("rm-pwd-generic", "sub_assembly")).toBe(
      "raw_material",
    );
    expect(coerceHubItemType("RM-DKT-GENERIC-SLAB", "service")).toBe(
      "raw_material",
    );
  });

  it("forces legacy FAB-/PWD-/STN- material prefixes to raw_material", () => {
    expect(coerceHubItemType("FAB-ACT-ASH", "finished_good")).toBe(
      "raw_material",
    );
    expect(coerceHubItemType("PWD-BLACK", "sub_assembly")).toBe("raw_material");
    expect(coerceHubItemType("STN-DKT-ZENITH", "service")).toBe("raw_material");
  });

  it("preserves finished-good / sub-assembly namespaces", () => {
    expect(coerceHubItemType("FIN-WFT-DIN-TAB-72X28", "finished_good")).toBe(
      "finished_good",
    );
    expect(coerceHubItemType("SA-WFT-DIN-TAB-72X28-BASE", "sub_assembly")).toBe(
      "sub_assembly",
    );
    expect(coerceHubItemType("ASM-BRV-SOF-72X34-FRAME", "finished_good")).toBe(
      "sub_assembly",
    );
  });

  it("isHubRawMaterialSku matches Hub + legacy material prefixes", () => {
    expect(isHubRawMaterialSku("RM-MET-2X2-TUBING")).toBe(true);
    expect(isHubRawMaterialSku("FAB-ACT-ASH")).toBe(true);
    expect(isHubRawMaterialSku("PWD-BLACK")).toBe(true);
    expect(isHubRawMaterialSku("FIN-WFT-DIN-TAB-72X28")).toBe(false);
    expect(isHubRawMaterialSku("BRA-C-34X84-LS-BO")).toBe(false);
    expect(isHubRawMaterialSku("SHD-SAIL-10X10")).toBe(false);
  });
});

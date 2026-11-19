import { describe, expect, it } from "vitest";
import {
  FINISH_KEY_ALIASES,
  FINISH_RULES,
  FINISH_SLOTS,
  SUPPORTED_PLACEHOLDER_SKUS,
  classifyFinishKey,
  isGenericPlaceholderSku,
  normalizeFinishKey,
  skuPrefix,
} from "@/server/woocommerce/finish-keys";

describe("finish keys (Phase B1 / pipe-hardening)", () => {
  it("accepted finish slots are fabric, powder_coat, frame, dekton", () => {
    expect([...FINISH_SLOTS]).toEqual(["fabric", "powder_coat", "frame", "dekton"]);
    for (const slot of FINISH_SLOTS) {
      expect(classifyFinishKey(slot)).toEqual({ kind: "slot", slot });
    }
  });

  it("slot prefixes are locked: FAB-, PWD-, MET-, DKT-", () => {
    expect(FINISH_RULES.fabric.requiredPrefix).toBe("FAB");
    expect(FINISH_RULES.powder_coat.requiredPrefix).toBe("PWD");
    expect(FINISH_RULES.frame.requiredPrefix).toBe("MET");
    expect(FINISH_RULES.dekton.requiredPrefix).toBe("DKT");
  });

  it.each([
    ["FABRIC", "fabric"],
    ["  Powder_Coat ", "powder_coat"],
    ["pa_fabric", "fabric"],
    ["attribute_pa_powder_coat", "powder_coat"],
    ["attribute_frame", "frame"],
    ["_frame", "frame"],
    ["attribute_pa_dekton", "dekton"],
  ])("normalizes %j to the slot %s", (raw, slot) => {
    expect(classifyFinishKey(raw)).toEqual({ kind: "slot", slot });
  });

  it.each([
    ["fabric_sku", "fabric"],
    ["frame_material", "frame"],
    ["pa_fabric_sku", "fabric"],
    ["attribute_frame_material", "frame"],
  ])("accepts alias %j as slot %s", (raw, slot) => {
    expect(FINISH_KEY_ALIASES[normalizeFinishKey(raw)] ?? classifyFinishKey(raw)).toBeTruthy();
    expect(classifyFinishKey(raw)).toEqual({ kind: "slot", slot });
  });

  it.each([
    ["Select Fabric", "fabric"],
    ["Choose Fabric", "fabric"],
    ["Fabric Swatch", "fabric"],
    ["Cushion Fabric", "fabric"],
    ["cushion_fabric", "fabric"],
    ["Select Powder Coat", "powder_coat"],
    ["Choose Powder Coat", "powder_coat"],
    ["Powder Coat", "powder_coat"],
    ["Powder Finish", "powder_coat"],
    ["Select Finish", "powder_coat"],
    ["powder-coat", "powder_coat"],
    ["Select Frame Type", "frame"],
    ["Frame Material", "frame"],
    ["frame_type", "frame"],
    ["frame-type", "frame"],
  ])("accepts human APF label %j as slot %s", (raw, slot) => {
    expect(classifyFinishKey(raw)).toEqual({ kind: "slot", slot });
  });

  it.each([
    "stone",
    "shade",
    "umbrella",
    "furniture",
    "finished_good",
    "firepit",
    "pillow",
    "pillow_fabric",
  ])("rejects the near-miss material key %s", (key) => {
    expect(classifyFinishKey(key).kind).toBe("rejected");
  });

  it.each(["size", "pa_size", "fabric_grade", "color", "note", "_reduced_stock", "config_id"])(
    "ignores the non-physical key %s",
    (key) => {
      expect(classifyFinishKey(key)).toEqual({ kind: "ignored" });
    },
  );

  it("fabric/powder/frame/dekton placeholders are supported for swap", () => {
    expect(SUPPORTED_PLACEHOLDER_SKUS.has("RM-FAB-GENERIC")).toBe(true);
    expect(SUPPORTED_PLACEHOLDER_SKUS.has("RM-PWD-GENERIC")).toBe(true);
    expect(SUPPORTED_PLACEHOLDER_SKUS.has("RM-FRAME-GENERIC")).toBe(true);
    expect(SUPPORTED_PLACEHOLDER_SKUS.has("RM-DKT-GENERIC-SLAB")).toBe(true);
    expect(isGenericPlaceholderSku("RM-DKT-GENERIC-SLAB")).toBe(true);
    expect(isGenericPlaceholderSku("RM-TUBE-1")).toBe(false);
  });

  it("skuPrefix is the segment before the first dash", () => {
    expect(skuPrefix("MET-ALUM")).toBe("MET");
    expect(skuPrefix("NODASH")).toBe("NODASH");
  });
});

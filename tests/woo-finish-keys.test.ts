import { describe, expect, it } from "vitest";
import {
  FINISH_RULES,
  FINISH_SLOTS,
  SUPPORTED_PLACEHOLDER_SKUS,
  classifyFinishKey,
  isGenericPlaceholderSku,
  normalizeFinishKey,
  skuPrefix,
} from "@/server/woocommerce/finish-keys";

describe("finish keys (Phase B1 operator decision D2)", () => {
  it("the only accepted finish keys are fabric, powder_coat, frame", () => {
    expect([...FINISH_SLOTS]).toEqual(["fabric", "powder_coat", "frame"]);
    for (const slot of FINISH_SLOTS) {
      expect(classifyFinishKey(slot)).toEqual({ kind: "slot", slot });
    }
  });

  it("slot prefixes are locked: FAB-, PWD-, MET-", () => {
    expect(FINISH_RULES.fabric.requiredPrefix).toBe("FAB");
    expect(FINISH_RULES.powder_coat.requiredPrefix).toBe("PWD");
    expect(FINISH_RULES.frame.requiredPrefix).toBe("MET");
  });

  it.each([
    ["FABRIC", "fabric"],
    ["  Powder_Coat ", "powder_coat"],
    ["pa_fabric", "fabric"],
    ["attribute_pa_powder_coat", "powder_coat"],
    ["attribute_frame", "frame"],
    ["_frame", "frame"],
  ])("normalizes %j to the slot %s", (raw, slot) => {
    expect(classifyFinishKey(raw)).toEqual({ kind: "slot", slot });
  });

  it.each([
    "cushion_fabric",
    "cushion-fabric",
    "powder",
    "powder-coat",
    "frame_type",
    "frame-type",
    "pa_frame-type",
    "stone",
    "dekton",
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

  it("a hyphenated powder-coat is NOT silently accepted as powder_coat", () => {
    expect(normalizeFinishKey("powder-coat")).toBe("powder-coat");
    expect(classifyFinishKey("powder-coat").kind).toBe("rejected");
  });

  it.each(["size", "pa_size", "fabric_grade", "color", "note", "_reduced_stock", "config_id"])(
    "ignores the non-physical key %s",
    (key) => {
      expect(classifyFinishKey(key)).toEqual({ kind: "ignored" });
    },
  );

  it("only the fabric and powder placeholders are supported for swap, plus the frame placeholder when provisioned", () => {
    expect(SUPPORTED_PLACEHOLDER_SKUS.has("RM-FAB-GENERIC")).toBe(true);
    expect(SUPPORTED_PLACEHOLDER_SKUS.has("RM-PWD-GENERIC")).toBe(true);
    expect(SUPPORTED_PLACEHOLDER_SKUS.has("RM-FRAME-GENERIC")).toBe(true);
    expect(SUPPORTED_PLACEHOLDER_SKUS.has("RM-DKT-GENERIC-SLAB")).toBe(false);
    expect(isGenericPlaceholderSku("RM-DKT-GENERIC-SLAB")).toBe(true);
    expect(isGenericPlaceholderSku("RM-TUBE-1")).toBe(false);
  });

  it("skuPrefix is the segment before the first dash", () => {
    expect(skuPrefix("MET-ALUM")).toBe("MET");
    expect(skuPrefix("NODASH")).toBe("NODASH");
  });
});

import { describe, expect, it } from "vitest";
import { toKatanaRecipePosts, type HubRecipeLine } from "@/lib/katana-recipe-graph";
import { formatKatanaIngredientNote, type CutLine } from "@/lib/sketchup-cutlist";

describe("toKatanaRecipePosts cut-list notes", () => {
  it("prefers chop-saw notes over UOM for recipe row notes", () => {
    const lines: HubRecipeLine[] = [
      {
        parentSku: "SA-BRV-CLB-CHA-34X34-SEAT",
        childSku: "RM-MET-2X2-TUBING",
        childItemType: "raw_material",
        quantity: 14,
        scrapFactor: 1.08,
        effectiveQuantity: 15.12,
        unitOfMeasure: "ft",
        notes: "4 pcs @ 34.0 in · 45°/45° mitre",
      },
    ];
    const posts = toKatanaRecipePosts(lines);
    expect(posts).toHaveLength(1);
    expect(posts[0].rows[0].notes).toBe("4 pcs @ 34.0 in · 45°/45° mitre");
    expect(posts[0].rows[0].quantity).toBe(15.12);
  });

  it("falls back to UOM only when notes empty", () => {
    const lines: HubRecipeLine[] = [
      {
        parentSku: "SA-TEST",
        childSku: "RM-TEST",
        childItemType: "raw_material",
        quantity: 1,
        scrapFactor: 1,
        effectiveQuantity: 1,
        unitOfMeasure: "ea",
        notes: "",
      },
    ];
    expect(toKatanaRecipePosts(lines)[0].rows[0].notes).toBe("ea");
  });

  it("formatKatanaIngredientNote never emits JSON braces", () => {
    const cut: CutLine = {
      role: "apron",
      profile: "SQ2-16",
      lengthIn: 34,
      endA: 45,
      endB: 45,
      qtyEa: 4,
      lengthConvention: "long_point",
      sourceName: "apron",
      confidence: "stated",
      drawingPartNumber: "CUT-SQ2-16-34.0-4545C",
    };
    const note = formatKatanaIngredientNote([cut]);
    expect(note).toBe("4 pcs @ 34.0 in · 45°/45° mitre");
    expect(note).not.toContain("{");
    expect(note).not.toContain("cut_list");
  });
});

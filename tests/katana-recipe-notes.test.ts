import { describe, expect, it } from "vitest";
import { toKatanaRecipePosts, type HubRecipeLine } from "@/lib/katana-recipe-graph";

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
        notes: '4ea 34.0in 45/45C LP; 4ea 8.0in 90/90',
      },
    ];
    const posts = toKatanaRecipePosts(lines);
    expect(posts).toHaveLength(1);
    expect(posts[0].rows[0].notes).toBe(
      '4ea 34.0in 45/45C LP; 4ea 8.0in 90/90',
    );
    expect(posts[0].rows[0].quantity).toBe(15.12);
  });
});

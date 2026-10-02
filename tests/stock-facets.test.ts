import { describe, expect, it } from "vitest";
import { stockFacet } from "@/lib/stock-facets";

describe("stock facets", () => {
  it("splits a fabric name into collection and color", () => {
    expect(stockFacet("CASSAVA WHITE")).toEqual({ collection: "Cassava", variant: "White" });
    expect(stockFacet("crush charcoal")).toEqual({ collection: "Crush", variant: "Charcoal" });
  });

  it("keeps a dekton thickness as the variant", () => {
    expect(stockFacet("ZENITH 2.0")).toEqual({ collection: "Zenith", variant: "2.0" });
  });

  it("keeps a single-word name as its own collection", () => {
    expect(stockFacet("Canvas")).toEqual({ collection: "Canvas", variant: "Standard" });
    expect(stockFacet(null)).toEqual({ collection: "Other", variant: "Standard" });
  });
});

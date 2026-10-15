import { describe, expect, it, vi, beforeEach } from "vitest";

const mockCollections = [
  { code: "MAL", label: "Malibu", is_active: true, aliases: ["Malibu Collection"] },
  { code: "OLD", label: "Old Collection", is_active: false, aliases: [] },
];

const mockCategories = [
  { code: "CHA", label: "Chair", is_active: true, aliases: ["Dining Chair"] },
  { code: "SOF", label: "Sofa", is_active: true, aliases: [] },
];

vi.mock("@/server/db/client", () => ({
  getDb: vi.fn(() => ({
    query: {
      nomenclature_collections: {
        findMany: vi.fn().mockImplementation(async () => mockCollections.filter((c) => c.is_active)),
      },
      nomenclature_categories: {
        findMany: vi.fn().mockImplementation(async () => mockCategories.filter((c) => c.is_active)),
      },
    },
  })),
}));

import { loadIntakeTaxonomy } from "@/server/factory-bom/intake/taxonomy";

describe("Intake Taxonomy (loadIntakeTaxonomy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads only active collections and categories", async () => {
    const tax = await loadIntakeTaxonomy();

    expect(tax.collections).toHaveLength(1);
    expect(tax.collections[0]?.code).toBe("MAL");
    expect(tax.collections[0]?.label).toBe("Malibu");

    expect(tax.categories).toHaveLength(2);
    expect(tax.categories.map((c) => c.code)).toEqual(["CHA", "SOF"]);
  });
});

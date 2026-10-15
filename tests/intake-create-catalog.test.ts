import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSkuMappings: any[] = [];
const mockFinishedGoods: any[] = [];
const mockEcommerceListings: any[] = [];

vi.mock("@/server/db/client", () => {
  const fakeDb: any = {
    transaction: vi.fn(async (cb: any) => cb(fakeDb)),
    query: {
      sku_mappings: {
        findMany: vi.fn(async () => mockSkuMappings),
        findFirst: vi.fn(async () => mockSkuMappings[0] || null),
      },
      finished_goods_catalog: {
        findFirst: vi.fn(async () => mockFinishedGoods[0] || null),
      },
    },
    insert: vi.fn((table: any) => ({
      values: vi.fn((vals: any) => {
        const row = { id: `id-${Math.random()}`, ...vals };
        if (vals.sheet_order !== undefined) mockEcommerceListings.push(row);
        else if (vals.length !== undefined && vals.depth !== undefined) mockFinishedGoods.push(row);
        else if (vals.global_sku) mockSkuMappings.push(row);

        const resultPromise = Promise.resolve([row]);
        const builder: any = {
          returning: vi.fn(async () => [row]),
          then: (onfulfilled?: any) => resultPromise.then(onfulfilled),
        };
        return builder;
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => [{ top: 10 }]),
    })),
  };
  return { getDb: vi.fn(() => fakeDb) };
});

vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn().mockResolvedValue({
    email: "operator@ccpatio.com",
    role: "operator",
    verified: true,
  }),
  isEmbedPrincipal: vi.fn().mockReturnValue(false),
  logPimAudit: vi.fn().mockResolvedValue(undefined),
  GHL_EMBED_PRINCIPAL_EMAIL: "ghl-embed@ccpatio.com",
}));

vi.mock("@/server/master-catalog/sku-preview", () => ({
  previewSku: vi.fn().mockImplementation(async (name, colLabel, catCode, l, d) => {
    const isCollision = mockSkuMappings.some((m) => m.global_sku === "FIN-MAL-SOF-96X38");
    return {
      sku: "FIN-MAL-SOF-96X38",
      collectionLabel: colLabel,
      categoryLabel: "Sofa",
      isCollision,
      existingProductName: isCollision ? "Existing Malibu Sofa" : undefined,
    };
  }),
}));

import { createIntake } from "@/server/factory-bom/intake/create-intake";

describe("createIntake (Catalog Path)", () => {
  beforeEach(() => {
    mockSkuMappings.length = 0;
    mockFinishedGoods.length = 0;
    mockEcommerceListings.length = 0;
    vi.clearAllMocks();
  });

  const baseCatalogInput = {
    mode: "catalog" as const,
    intakeKey: "f1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c99",
    productName: "Malibu Sofa",
    collectionCode: "MAL",
    collectionLabel: "Malibu",
    categoryCode: "SOF",
    categoryLabel: "Sofa",
    length: 96.4,
    depth: 38.2,
    files: {
      cad: { filename: "malibu.glb", byteSize: 1024 * 100 },
    },
  };

  it("happy path creates sku_mappings, finished_goods_catalog, and ecommerce_listings rows", async () => {
    const res = await createIntake(baseCatalogInput);

    expect(res.replayed).toBe(false);
    expect(res.sku).toBe("FIN-MAL-SOF-96X38");
    expect(mockSkuMappings.length).toBe(1);
    expect(mockFinishedGoods.length).toBe(1);
    expect(mockEcommerceListings.length).toBe(1);

    // Verify exact text preserved for dimensions
    expect(mockFinishedGoods[0]?.length).toBe("96.4");
    expect(mockFinishedGoods[0]?.depth).toBe("38.2");
  });

  it("replay with same key and payload returns same SKU without adding duplicate rows", async () => {
    const first = await createIntake(baseCatalogInput);
    const second = await createIntake(baseCatalogInput);

    expect(second.replayed).toBe(true);
    expect(second.sku).toBe(first.sku);
    expect(mockSkuMappings.length).toBe(1);
  });

  it("detects collision and asks with DUPLICATE_PRODUCT", async () => {
    // Insert an existing SKU
    mockSkuMappings.push({
      global_sku: "FIN-MAL-SOF-96X38",
      original_name: "Existing Malibu Sofa",
      attributes: {},
    });

    await expect(
      createIntake({
        ...baseCatalogInput,
        intakeKey: "e1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c00",
      })
    ).rejects.toThrow();
  });

  it("resolves collision with collisionDecision: different -> appends -V2", async () => {
    mockSkuMappings.push({
      global_sku: "FIN-MAL-SOF-96X38",
      original_name: "Existing Malibu Sofa",
      attributes: {},
    });

    const res = await createIntake({
      ...baseCatalogInput,
      intakeKey: "d1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c01",
      collisionDecision: "different",
    });

    expect(res.sku).toBe("FIN-MAL-SOF-96X38-V2");
  });

  it("resolves collision with collisionDecision: update_model -> logs intake.update_model audit row and returns existing sku", async () => {
    mockSkuMappings.push({
      global_sku: "FIN-MAL-SOF-96X38",
      original_name: "Existing Malibu Sofa",
      attributes: {},
    });

    const { logPimAudit } = await import("@/lib/pim-audit");

    const res = await createIntake({
      ...baseCatalogInput,
      intakeKey: "d1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c02",
      collisionDecision: "update_model",
    });

    expect(res.sku).toBe("FIN-MAL-SOF-96X38");
    expect(res.replayed).toBe(false);
    expect(logPimAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "intake.update_model",
        globalSku: "FIN-MAL-SOF-96X38",
      })
    );
  });
});

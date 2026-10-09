import { describe, expect, it, vi } from "vitest";
import { publishApprovedRecipeToKatana } from "@/app/admin/factory-bom/actions";
import { syncBOMToKatana } from "@/lib/katana";

vi.mock("@/lib/katana", () => ({
  syncBOMToKatana: vi.fn(),
}));

vi.mock("@/server/factory-bom/load-airlock-snapshot", () => ({
  loadAirlockSnapshot: vi.fn().mockResolvedValue({
    lines: [{ parent_sku: "FIN-TEST", child_sku: "RM-TEST", quantity: "1", scrap_factor: "1", unit_of_measure: "ea", status: "draft_pending_review", source: "manager", notes: null, cut_list: [] }],
    operations: [],
    cadUpload: null,
    releaseGate: null,
  })
}));

vi.mock("@/server/factory-bom/list-factory-products", () => ({
  listFactoryProducts: vi.fn().mockResolvedValue([
    { sku: "FIN-TEST", itemType: "finished_good", name: "Test Product", katanaVariantId: 123 },
    { sku: "RM-TEST", itemType: "raw_material", name: "Test RM", katanaVariantId: 456 },
  ])
}));

vi.mock("@/server/factory-bom/evaluate-airlock", () => ({
  evaluateAirlock: vi.fn().mockReturnValue([])
}));

vi.mock("@/server/factory-bom/shop-drawing", () => ({
  renderShopDrawingPdf: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3]))
}));

vi.mock("@/lib/supabase-storage", () => ({
  getSupabaseAdmin: vi.fn().mockReturnValue({
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: null })
      })
    }
  }),
  PRODUCT_DOCUMENTS_BUCKET: "test-bucket"
}));

vi.mock("@/server/factory-bom/dossier-hash", () => ({
  computeDossierHash: vi.fn().mockReturnValue("HASH_MATCH")
}));

vi.mock("@/lib/pim-audit", () => ({
  getPimSession: vi.fn().mockResolvedValue({ email: "test@example.com" }),
  logPimAudit: vi.fn().mockResolvedValue(true)
}));

vi.mock("@/server/pipeline/catalog-mode", () => ({
  getCatalogPublishMode: vi.fn().mockReturnValue("live"),
  canMutateKatanaCatalog: vi.fn().mockReturnValue(true)
}));

const mockDb: any = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  leftJoin: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn().mockReturnThis(),
  transaction: vi.fn().mockImplementation(async (cb: any) => cb(mockDb)),
  then: function(resolve: any) {
    resolve([{ 
      status: "success", 
      payload_hash: "HASH_MATCH", 
      storage_path: "path", 
      child: "RM-TEST", 
      type: "raw_material",
      sku: "FIN-TEST",
      itemType: "finished_good",
      originalName: "Test Product",
      katanaVariantId: 123
    }]);
  }
};

vi.mock("@/server/db/client", () => ({
  getDb: () => mockDb,
}));

describe("Idempotent Network Skip", () => {
  it("skips Katana API call when dossierHash matches channel_sync.payload_hash", async () => {
    // payload_hash: "HASH_MATCH" is mocked to be returned from db.select()
    const result = await publishApprovedRecipeToKatana("FIN-TEST");
    
    expect(result).toEqual({
      ok: true,
      idempotent: true,
      dossierHash: "HASH_MATCH",
      message: "Idempotent skip: dossier hash unchanged"
    });
    expect(syncBOMToKatana).not.toHaveBeenCalled();
  });
});

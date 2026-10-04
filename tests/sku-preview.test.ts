import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { previewSku } from "@/server/master-catalog/sku-preview";
import { getDb } from "@/server/db/client";
import { sku_mappings, ecommerce_listings, nomenclature_collections, nomenclature_categories } from "@/server/db/schema";
import { eq } from "drizzle-orm";

describe("previewSku", () => {
  const db = getDb();
  
  beforeAll(async () => {
    // Insert test dictionaries
    await db.insert(nomenclature_collections).values({
      code: "TESTCOL",
      label: "Test Collection",
      is_active: true,
      created_by: "test",
    }).onConflictDoNothing();
    
    await db.insert(nomenclature_categories).values({
      code: "TESTCAT",
      label: "Test Category",
      is_active: true,
      created_by: "test",
    }).onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(nomenclature_collections).where(eq(nomenclature_collections.code, "TESTCOL"));
    await db.delete(nomenclature_categories).where(eq(nomenclature_categories.code, "TESTCAT"));
  });

  it("handles the valid dictionary codes (no collision)", async () => {
    const result = await previewSku("Test Name", "Test Collection", "TESTCAT", "934", "934", null, "manufactured", undefined, "TESTCOL", "Test Category");
    expect(result.sku).toBe("FIN-TESTCOL-TESTCAT-934X934");
    expect(result.isCollision).toBe(false);
    expect(result.isSaved).toBe(false);
  });

  it("rejects reserved codes", async () => {
    await expect(previewSku("Test Name", "Test Collection", "FIN", "934", "934", null, "manufactured", undefined, "TESTCOL", "Test Category")).rejects.toThrow("Cannot use reserved code");
    await expect(previewSku("Test Name", "Test Collection", "TESTCAT", "934", "934", null, "manufactured", undefined, "FAB", "Test Category")).rejects.toThrow("Cannot use reserved code");
    await expect(previewSku("Test Name", "Test Collection", "TESTCAT", "934", "934", null, "manufactured", undefined, "3P", "Test Category")).rejects.toThrow("Cannot use reserved code");
  });

  it("rejects invalid or missing dictionary codes", async () => {
    await expect(previewSku("Test Name", "Test Collection", "BADCAT", "934", "934", null, "manufactured", undefined, "TESTCOL", "Test Category")).rejects.toThrow("Category code BADCAT is invalid or inactive");
    await expect(previewSku("Test Name", "Test Collection", "TESTCAT", "934", "934", null, "manufactured", undefined, "BADCOL", "Test Category")).rejects.toThrow("Collection code BADCOL is invalid or inactive");
  });

  it("validates 3rd party token presence", async () => {
    // Valid 3rd party
    const result = await previewSku("Test Name", "Test Collection", "TESTCAT", "934", "934", null, "third_party", "TKN123", "TESTCOL", "Test Category");
    expect(result.sku).toBe("3P-TESTCOL-TESTCAT-TKN123");
    
    // Missing token
    await expect(previewSku("Test Name", "Test Collection", "TESTCAT", "934", "934", null, "third_party", "", "TESTCOL", "Test Category")).rejects.toThrow("Missing token for 3rd party product");
  });

  it("detects a collision when the SKU already exists", async () => {
    const sku = "FIN-TESTCOL-TESTCAT-935X935";
    
    await db.delete(ecommerce_listings).where(eq(ecommerce_listings.global_sku, sku));
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, sku));

    await db.insert(sku_mappings).values({
      global_sku: sku,
      category: "Test Collection",
      item_type: "finished_good",
      original_name: "Original Hub Name",
      source_file: "test",
      is_active: true,
    });
    await db.insert(ecommerce_listings).values({
      global_sku: sku,
      product_name: "Existing Listing Name",
      collection_label: "Test Collection",
      drawing_section: "Test",
      sheet_order: 9999,
      url_source: "missing",
      url_operator_set: false,
      legacy_operator_set: false,
    });

    try {
      const result = await previewSku("Test Collision", "Test Collection", "TESTCAT", "935", "935", null, "manufactured", undefined, "TESTCOL", "Test Category");
      expect(result.sku).toBe(sku);
      expect(result.isCollision).toBe(true);
      expect(result.isSaved).toBe(false);
      expect(result.existingProductName).toBe("Existing Listing Name");
    } finally {
      await db.delete(ecommerce_listings).where(eq(ecommerce_listings.global_sku, sku));
      await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, sku));
    }
  });

  it("refuses to change a saved SKU (passes through existing SKU)", async () => {
    const existingSku = "FIN-OLD-SKU-TEST";
    const result = await previewSku("Test Name", "Test Collection", "TESTCAT", "34", "34", existingSku, "manufactured", undefined, "TESTCOL", "Test Category");
    
    expect(result.sku).toBe(existingSku);
    expect(result.isCollision).toBe(false);
    expect(result.isSaved).toBe(true);
  });
});

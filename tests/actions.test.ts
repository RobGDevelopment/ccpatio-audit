import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { createDictionaryCode, createNewProduct, previewSkuAction } from "@/app/embed/admin/master-catalog/actions";
import { getDb } from "@/server/db/client";
import { 
  nomenclature_collections, 
  nomenclature_categories, 
  user_roles,
  sku_mappings,
  ecommerce_listings,
  finished_goods_catalog,
  third_party_sources,
  catalog_ship_profiles
} from "@/server/db/schema";
import { eq } from "drizzle-orm";

const TEST_USER_ID = vi.hoisted(() => globalThis.crypto.randomUUID());

// revalidatePath needs a Next.js request store that doesn't exist under vitest.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Mock Supabase Auth
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: TEST_USER_ID, email: "test@ccpatio.com" } }
      })
    }
  }))
}));

describe("Server Actions: Master Catalog", () => {
  const db = getDb();
  let createdMlnFixture = false;

  // Fixtures (TST / TST-CAT / user role) live for the ENTIRE file and are torn
  // down only after the last describe block (incl. createNewProduct) completes.
  afterAll(async () => {
    const sku = "3P-TST-TST-CAT-TKN";
    const aliasSku = "FIN-MLN-TST-CAT-11X22";
    for (const s of [sku, aliasSku]) {
      await db.delete(ecommerce_listings).where(eq(ecommerce_listings.global_sku, s));
      await db.delete(finished_goods_catalog).where(eq(finished_goods_catalog.global_sku, s));
      await db.delete(third_party_sources).where(eq(third_party_sources.global_sku, s));
      await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, s));
    }
    if (createdMlnFixture) {
      await db.delete(nomenclature_collections).where(eq(nomenclature_collections.code, "MLN"));
    }
    await db.delete(user_roles).where(eq(user_roles.id, TEST_USER_ID));
    await db.delete(nomenclature_collections).where(eq(nomenclature_collections.code, "TST"));
    await db.delete(nomenclature_categories).where(eq(nomenclature_categories.code, "TST-CAT"));
    await db.delete(nomenclature_categories).where(eq(nomenclature_categories.code, "TST-MUL-SEG"));
  });

  describe("createDictionaryCode", () => {

    it("rejects when user is not Ops_Manager or SuperAdmin", async () => {
      await db.delete(user_roles).where(eq(user_roles.id, TEST_USER_ID));
      await db.insert(user_roles).values({ id: TEST_USER_ID, role: "Designer" });
      
      await expect(createDictionaryCode("collection", "TST", "Test")).rejects.toThrow("Unauthorized");
    });

    it("accepts when user is Ops_Manager and validates length/regex", async () => {
      await db.delete(user_roles).where(eq(user_roles.id, TEST_USER_ID));
      await db.insert(user_roles).values({ id: TEST_USER_ID, role: "Ops_Manager" });
      
      // Collection rules: ^[A-Z0-9]{2,4}$, no hyphens
      await expect(createDictionaryCode("collection", "T", "Too Short")).rejects.toThrow("2 to 4 characters");
      await expect(createDictionaryCode("collection", "TOOLONG", "Too Long")).rejects.toThrow("2 to 4 characters");
      await expect(createDictionaryCode("collection", "A-B", "Hyphen")).rejects.toThrow("2 to 4 characters");
      
      // Category rules: ^[A-Z0-9]+(-[A-Z0-9]+)*$, max 24
      await expect(createDictionaryCode("category", "-BAD", "Ok")).rejects.toThrow("format"); 
      await expect(createDictionaryCode("category", "BAD--CAT", "Ok")).rejects.toThrow("format");
      await expect(createDictionaryCode("category", "A".repeat(25), "Ok")).rejects.toThrow("format");
      
      // Valid insertions (incl. multi-segment legacy-style category)
      await createDictionaryCode("collection", "TST", "Actions Suite Collection");
      await createDictionaryCode("category", "TST-CAT", "Actions Suite Category");
      // 3-segment code like legacy TRA-DOU-CHS must pass the regex
      await createDictionaryCode("category", "TST-MUL-SEG", "Actions Suite Multi Segment");
      
      const cols = await db.select().from(nomenclature_collections).where(eq(nomenclature_collections.code, "TST"));
      expect(cols).toHaveLength(1);
    });
    
    it("rejects reserved codes and strict prefixes", async () => {
      await expect(createDictionaryCode("collection", "FIN", "Finished")).rejects.toThrow("reserved system code");
      await expect(createDictionaryCode("collection", "MIS", "Miscellaneous")).rejects.toThrow("reserved system code");
      await expect(createDictionaryCode("token", "PWD-BASE", "Powder Base")).rejects.toThrow("reserved system code");
      await expect(createDictionaryCode("token", "SA-CUSHION", "Cushion")).rejects.toThrow("reserved system code");
    });

  describe("getDictionaries", () => {
    it("extracts tokens cleanly avoiding hyphens in category or collection", async () => {
      const db = getDb();
      // Insert collection TSTB, category TST-ARM-CHR
      await db.insert(nomenclature_collections).values({ code: "TSTB", label: "TSTB", created_by: "test@ccpatio.com" }).onConflictDoNothing();
      await db.insert(nomenclature_categories).values({ code: "TST-ARM-CHR", label: "TST ARM CHR", created_by: "test@ccpatio.com" }).onConflictDoNothing();
      // Insert mapping 3P-TSTB-TST-ARM-CHR-BLK
      await db.insert(sku_mappings).values({
        global_sku: "3P-TSTB-TST-ARM-CHR-BLK",
        product_origin: "third_party",
        category: "Test"
      }).onConflictDoNothing();

      const { getDictionaries } = await import("@/app/embed/admin/master-catalog/actions");
      const { tokens } = await getDictionaries();
      expect(tokens.map(t => t.code)).toContain("BLK");
      expect(tokens.map(t => t.code)).not.toContain("CHR-BLK");
      
      // Cleanup
      await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, "3P-TSTB-TST-ARM-CHR-BLK"));
      await db.delete(nomenclature_categories).where(eq(nomenclature_categories.code, "TST-ARM-CHR"));
      await db.delete(nomenclature_collections).where(eq(nomenclature_collections.code, "TSTB"));
    });
  });
  });

  describe("createNewProduct", () => {
    beforeAll(async () => {
      // Ensure the actor is authorized and fixtures from the prior block are alive.
      await db.delete(user_roles).where(eq(user_roles.id, TEST_USER_ID));
      await db.insert(user_roles).values({ id: TEST_USER_ID, role: "Ops_Manager" });
    });

    it("inserts 3rd party vendor data correctly", async () => {
      const row = await createNewProduct({
        productName: "Test 3P Product",
        collectionLabel: "Actions Suite Collection",
        categoryCode: "TST-CAT",
        categoryLabel: "Actions Suite Category",
        length: "1",
        depth: "1",
        origin: "third_party",
        token: "TKN",
        collectionCode: "TST",
        thirdPartyFields: {
          vendorName: "Test Vendor",
          vendorSku: "VND-123",
          wholesaleCost: "150.00"
        }
      });
      
      expect(row).toBeDefined();
      
      const tps = await db.select().from(third_party_sources).where(eq(third_party_sources.global_sku, "3P-TST-TST-CAT-TKN"));
      expect(tps).toHaveLength(1);
      expect(tps[0].vendor_name).toBe("Test Vendor");
      expect(tps[0].wholesale_cost).toBe("150.0000"); // Numeric(12,4)
    });

    describe("alias label persistence", () => {
      const ALIAS_CAT_LABEL = "Actions Suite Category Alias";
      const aliasPayload = {
        productName: "Alias Probe",
        collectionLabel: "Marina",
        collectionCode: "MLN",
        categoryCode: "TST-CAT",
        categoryLabel: ALIAS_CAT_LABEL,
        length: "11",
        depth: "22",
        origin: "manufactured" as const,
      };

      beforeAll(async () => {
        // Real seeded row is MLN/Milan[Marina]. Only create the fixture if it's absent.
        const [mln] = await db.select().from(nomenclature_collections).where(eq(nomenclature_collections.code, "MLN"));
        if (!mln) {
          await db.insert(nomenclature_collections).values({
            code: "MLN", label: "Milan", aliases: ["Marina"], created_by: "test",
          });
          createdMlnFixture = true;
        } else if (!(mln.aliases ?? []).includes("Marina")) {
          throw new Error("MLN exists without the 'Marina' alias; run scripts/seed-dictionaries.ts");
        }
        await db
          .update(nomenclature_categories)
          .set({ aliases: [ALIAS_CAT_LABEL] })
          .where(eq(nomenclature_categories.code, "TST-CAT"));
      });

      it("rejects labels that match neither the primary label nor an alias", async () => {
        await expect(createNewProduct({ ...aliasPayload, collectionLabel: "Bogus" })).rejects.toThrow("does not match code MLN");
        await expect(createNewProduct({ ...aliasPayload, categoryLabel: "Bogus" })).rejects.toThrow("does not match code TST-CAT");
        // a label belonging to a DIFFERENT code must not validate
        await expect(createNewProduct({ ...aliasPayload, collectionLabel: "Actions Suite Collection" })).rejects.toThrow("does not match code MLN");
        await expect(createNewProduct({ ...aliasPayload, categoryLabel: undefined as unknown as string })).rejects.toThrow("label is required");
      });

      it("previewSkuAction returns the validated submitted (alias) labels", async () => {
        const p = await previewSkuAction(
          aliasPayload.productName, "Marina", "TST-CAT", "11", "22", null,
          "manufactured", undefined, "MLN", ALIAS_CAT_LABEL,
        );
        expect(p.sku).toBe("FIN-MLN-TST-CAT-11X22");
        expect(p.collectionLabel).toBe("Marina");
        expect(p.categoryLabel).toBe(ALIAS_CAT_LABEL);
      });

      it("mints with code in the SKU but persists the selected alias labels", async () => {
        const row = await createNewProduct(aliasPayload);

        expect(row.global_sku).toBe("FIN-MLN-TST-CAT-11X22");
        expect(row.collection_label).toBe("Marina");
        expect(row.collection_label).not.toBe("Milan");
        expect(row.drawing_section).toBe(ALIAS_CAT_LABEL);

        const [stored] = await db
          .select()
          .from(ecommerce_listings)
          .where(eq(ecommerce_listings.global_sku, "FIN-MLN-TST-CAT-11X22"));
        expect(stored.collection_label).toBe("Marina");
        expect(stored.drawing_section).toBe(ALIAS_CAT_LABEL);
      });
    });
  });

  describe("Phase 3 Remediation", () => {
    it("saveFreightProfile enforces math rules", async () => {
      const { saveFreightProfile } = await import("@/app/embed/admin/master-catalog/actions");
      const db = getDb();
      await saveFreightProfile("FIN-MLN-TST-CAT-11X22", {
        shipMode: "ltl",
        lengthIn: "20",
        widthIn: "20",
        heightIn: "20", // dim = 8000/139 = 57.55 -> 58
        weightLb: "10",
        ltlClass: "50",
        stackable: false
      });
      const [row] = await db.select().from(catalog_ship_profiles).where(eq(catalog_ship_profiles.global_sku, "FIN-MLN-TST-CAT-11X22"));
      expect(row.dim_weight_lb).toBe("57.55");
      expect(row.billable_weight_lb).toBe("57.55");

      await saveFreightProfile("FIN-MLN-TST-CAT-11X22", {
        shipMode: "ltl",
        lengthIn: "10",
        widthIn: "10",
        heightIn: "10",
        weightLb: "15",
        ltlClass: "50",
        stackable: false
      });
      const [row2] = await db.select().from(catalog_ship_profiles).where(eq(catalog_ship_profiles.global_sku, "FIN-MLN-TST-CAT-11X22"));
      expect(row2.dim_weight_lb).toBe("7.19");
      expect(row2.billable_weight_lb).toBe("15.00");
    });
    it("scoreProduct enforces data logic", async () => {
      const { scoreProduct } = await import("@/server/pim/completeness");
      const snap3P: any = {
        origin: "third_party",
        globalSku: "3P-VEN-SKU",
        productName: "A", collectionLabel: "B",
        thirdParty: { vendorName: "x", vendorSku: "y", wholesaleCost: "10" },
        retailMsrp: null,
        assets: { hasPrimary: false },
        naFields: ["primary_image"],
        isWebVisible: true,
      };
      
      let res = scoreProduct(snap3P);
      expect(res.gates.find(g => g.id === "price")?.passed).toBe(false);
      // Hero N/A does not pass while the product is web-visible.
      expect(res.gates.find(g => g.id === "hero")?.passed).toBe(false);
      expect(res.heroNaAllowed).toBe(false);

      snap3P.isWebVisible = false;
      res = scoreProduct(snap3P);
      expect(res.gates.find(g => g.id === "hero")?.passed).toBe(true);
      expect(res.heroNaAllowed).toBe(true);

      const manufactured: any = {
        origin: "manufactured",
        globalSku: "FIN-MLN-TST-CAT-11X22",
        assets: { hasPrimary: false },
        naFields: ["primary_image"],
        isWebVisible: false,
      };
      expect(scoreProduct(manufactured).gates.find(g => g.id === "hero")?.passed).toBe(false);
      
      snap3P.retailMsrp = "20";
      res = scoreProduct(snap3P);
      expect(res.gates.find(g => g.id === "price")?.passed).toBe(true);
      
      const fullSnap3P = {
         ...snap3P,
         seoTitle: "a", seoDescription: "b", slug: "c", marketingDescription: "d",
         length: "1", depth: "1", height: "1", armHeight: "1", sitHeight: "1",
         shipProfile: { shipMode: "not_shipped" },
         assets: { hasPrimary: false, hasCare: true, hasWarranty: true, hasAssembly: true },
         warrantyTermMonths: 12,
         assemblyRequired: true,
         factoryState: "published",
         isWebVisible: false,
      };
      res = scoreProduct(fullSnap3P);
      expect(res.score).toBe(100);
      expect(res.canSyncClover).toBe(true);
      expect(res.canSyncWoo).toBe(false);
      
      fullSnap3P.assets.hasPrimary = true;
      fullSnap3P.isWebVisible = true;
      res = scoreProduct(fullSnap3P);
      expect(res.canSyncWoo).toBe(true);
    });
    it("generateTearSheetPdf enforces leaks and missing hero", async () => {
      const { generateTearSheetPdf } = await import("@/server/pim/tear-sheet");
      const res = await generateTearSheetPdf("FIN-MLN-TST-CAT-11X22");
      expect(res.pdf).toBeNull();
      expect(res.omitted.length).toBeGreaterThan(0);
    });
  });
});

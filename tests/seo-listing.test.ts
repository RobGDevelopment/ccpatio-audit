import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  generateAiSeoAction,
  getListingEditorData,
  saveListingSeo,
} from "@/app/embed/admin/master-catalog/actions";
import { getDb } from "@/server/db/client";
import {
  ecommerce_listings,
  finished_goods_catalog,
  pim_audit_log,
  sku_mappings,
} from "@/server/db/schema";

const SKU = "FIN-ZZV-SEO-1X1";
const SKU_B = "FIN-ZZV-SEO-2X2";
const NAME_A = "ZZV SEO Fixture Alpha";
const NAME_B = "ZZV SEO Fixture Beta";

const ctx = vi.hoisted(() => ({
  session: { email: "ops@ccpatio.com", name: "Ops" } as { email: string; name: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/pim-audit", async (orig) => ({
  ...(await orig<typeof import("@/lib/pim-audit")>()),
  getPimSession: vi.fn(async () => ctx.session),
  logPimAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase-storage", () => ({
  getVaultStorage: vi.fn(),
  createAssetSignedUpload: vi.fn(),
  createAssetSignedDownload: vi.fn(),
  createCadSignedUpload: vi.fn(),
  cadObjectPath: vi.fn(),
  downloadCadObject: vi.fn(),
  PRODUCT_IMAGES_BUCKET: "product-images",
  PRODUCT_DOCUMENTS_BUCKET: "product-documents",
  CAD_MODELS_BUCKET: "cad-models",
  CAD_MAX_BYTES: 25 * 1024 * 1024,
}));

const MODEL_JSON = JSON.stringify({
  seoTitle: "ZZV Alpha Lounge Chair | CC Patio",
  metaDescription: "A refined lounge chair designed for generous outdoor living.",
  slug: "zzv-alpha-lounge-chair",
});

describe("SEO listing actions", () => {
  const db = getDb();
  let listingA = "";
  let listingB = "";
  const original = { ...process.env };
  const fetchMock = vi.fn();

  const cleanup = async () => {
    await db.delete(ecommerce_listings).where(eq(ecommerce_listings.global_sku, SKU));
    await db.delete(ecommerce_listings).where(eq(ecommerce_listings.global_sku, SKU_B));
    await db.delete(finished_goods_catalog).where(eq(finished_goods_catalog.global_sku, SKU));
    await db.delete(finished_goods_catalog).where(eq(finished_goods_catalog.global_sku, SKU_B));
    await db.delete(pim_audit_log).where(eq(pim_audit_log.global_sku, SKU));
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, SKU));
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, SKU_B));
  };

  beforeAll(async () => {
    await cleanup();
    for (const [sku, name] of [[SKU, NAME_A], [SKU_B, NAME_B]] as const) {
      await db.insert(sku_mappings).values({
        global_sku: sku,
        product_origin: "manufactured",
        category: "ZZV-SEO",
        item_type: "finished_good",
        original_name: name,
        source_file: "tests/seo-listing.test.ts",
        is_active: true,
      });
    }
    await db.insert(finished_goods_catalog).values({
      global_sku: SKU,
      length: "30",
      depth: "34",
      height: "29",
      // Depth is flagged N/A: it must never reach the model even though a value is stored.
      na_fields: ["depth"],
      seo_title: "Hub default title",
      seo_description: "Hub default description",
      slug: "hub-default-slug",
    });
    const [a] = await db
      .insert(ecommerce_listings)
      .values({
        global_sku: SKU,
        product_name: NAME_A,
        drawing_section: "Lounge Chair",
        collection_label: "Zzv",
        sheet_order: 9_001,
        marketing_description: "<p>Hand-woven frame with <strong>deep</strong> seating.</p>",
      })
      .returning({ id: ecommerce_listings.id });
    const [b] = await db
      .insert(ecommerce_listings)
      .values({
        global_sku: SKU_B,
        product_name: NAME_B,
        drawing_section: "Lounge Chair",
        collection_label: "Zzv",
        sheet_order: 9_002,
      })
      .returning({ id: ecommerce_listings.id });
    listingA = a.id;
    listingB = b.id;
  });

  afterAll(async () => {
    process.env = { ...original };
    vi.unstubAllGlobals();
    await cleanup();
  });

  beforeEach(() => {
    ctx.session = { email: "ops@ccpatio.com", name: "Ops" };
    process.env.SEO_ASSISTANT_MODEL = "test-model";
    process.env.SEO_ASSISTANT_API_KEY = "sk-test";
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: MODEL_JSON } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  const promptOf = () => {
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    return body.messages.find((m: { role: string }) => m.role === "user").content as string;
  };

  describe("generateAiSeoAction", () => {
    it("omits dimensions flagged in na_fields from the prompt and never writes to the DB", async () => {
      const before = await db.select().from(ecommerce_listings).where(eq(ecommerce_listings.id, listingA));

      const out = await generateAiSeoAction(listingA);
      expect(out.slug).toBe("zzv-alpha-lounge-chair");
      expect(out.seoTitle).toContain("Alpha");

      const prompt = promptOf();
      expect(prompt).toContain("Length: 30 in");
      expect(prompt).toContain("Height: 29 in");
      expect(prompt).not.toMatch(/Depth/i);
      expect(prompt).not.toContain("34");
      // Saved marketing copy is sent as plain text, never markup.
      expect(prompt).toContain("Hand-woven frame with deep seating.");
      expect(prompt).not.toMatch(/<\/?(p|strong)>/);

      const after = await db.select().from(ecommerce_listings).where(eq(ecommerce_listings.id, listingA));
      expect(after[0].version).toBe(before[0].version);
      expect(after[0].seo_title).toBeNull();
      expect(after[0].slug).toBeNull();
      expect(after[0].updated_at.getTime()).toBe(before[0].updated_at.getTime());
    });

    it("works for a human operator who is ALSO inside the embed iframe (human outranks the principal)", async () => {
      // getPimSession now resolves the human first; the action only sees that human.
      ctx.session = { email: "ops@ccpatio.com", name: "Ops" };
      await expect(generateAiSeoAction(listingA)).resolves.toBeDefined();
    });

    it("rejects the bare embed principal (no human session)", async () => {
      ctx.session = { email: "ghl-embed@ccpatio.com", name: "GHL Embed" };
      await expect(generateAiSeoAction(listingA)).rejects.toThrow(/signed-in @ccpatio\.com operator/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("requires saved marketing copy", async () => {
      await expect(generateAiSeoAction(listingB)).rejects.toThrow("Save a marketing description");
    });
  });

  describe("getListingEditorData: hub defaults vs saved listing values", () => {
    it("returns them separately and reports AI eligibility per caller", async () => {
      const human = await getListingEditorData(listingA);
      expect(human.seoTitle).toBeNull();
      expect(human.slug).toBeNull();
      expect(human.hubSeoTitle).toBe("Hub default title");
      expect(human.hubSlug).toBe("hub-default-slug");
      expect(human.aiOperatorEligible).toBe(true);

      ctx.session = { email: "ghl-embed@ccpatio.com", name: "GHL Embed" };
      const embed = await getListingEditorData(listingA);
      expect(embed.aiOperatorEligible).toBe(false);
    });
  });

  describe("slug uniqueness", () => {
    it("saves a slug, then rejects the same slug on another live listing (action + DB index)", async () => {
      const a = await getListingEditorData(listingA);
      const saved = await saveListingSeo(listingA, a.version, {
        seoTitle: "T",
        seoDescription: "D",
        slug: "zzv-unique-slug",
        tags: ["Outdoor", "outdoor"],
      });
      expect(saved.tags).toEqual(["outdoor"]);

      const b = await getListingEditorData(listingB);
      await expect(
        saveListingSeo(listingB, b.version, { seoTitle: "", seoDescription: "", slug: "zzv-unique-slug", tags: [] }),
      ).rejects.toThrow(/already used by/);

      // The DB itself refuses it even if the action-level check is bypassed.
      await expect(
        db.update(ecommerce_listings).set({ slug: "zzv-unique-slug" }).where(eq(ecommerce_listings.id, listingB)),
      ).rejects.toThrow();
    });

    it("rejects un-normalized slugs on the server", async () => {
      const b = await getListingEditorData(listingB);
      await expect(
        saveListingSeo(listingB, b.version, { seoTitle: "", seoDescription: "", slug: "Not A Slug!", tags: [] }),
      ).rejects.toThrow(/lowercase letters, numbers and single hyphens/);
    });

    it("frees the slug once the owning listing is archived", async () => {
      await db.update(ecommerce_listings).set({ archived_at: new Date() }).where(eq(ecommerce_listings.id, listingA));
      await expect(
        db.update(ecommerce_listings).set({ slug: "zzv-unique-slug" }).where(eq(ecommerce_listings.id, listingB)),
      ).resolves.toBeDefined();
      await db.update(ecommerce_listings).set({ archived_at: null, slug: null }).where(eq(ecommerce_listings.id, listingA));
      await db.update(ecommerce_listings).set({ slug: null }).where(eq(ecommerce_listings.id, listingB));
    });
  });
});

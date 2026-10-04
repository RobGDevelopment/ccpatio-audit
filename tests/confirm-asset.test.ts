import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  confirmAsset,
  getProductAssets,
  deleteGalleryAsset,
  updateAssetAltText,
} from "@/app/embed/admin/master-catalog/actions";
import { getDb } from "@/server/db/client";
import {
  finished_goods_catalog,
  pim_audit_log,
  product_assets,
  sku_mappings,
} from "@/server/db/schema";

const SKU = "FIN-ZZV-CNF-1X1";

// In-memory stand-in for Supabase Storage, keyed `${bucket}/${path}`.
const store = vi.hoisted(() => new Map<string, { bytes: Uint8Array; contentType: string | null }>());

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/pim-audit", async (orig) => ({
  ...(await orig<typeof import("@/lib/pim-audit")>()),
  getPimSession: vi.fn().mockResolvedValue({ email: "test@ccpatio.com", name: "Test Operator" }),
  logPimAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase-storage", () => ({
  getVaultStorage: () => ({
    async download(bucket: string, path: string) {
      const hit = store.get(`${bucket}/${path}`);
      if (!hit) throw new Error("Object not found");
      return hit;
    },
    async remove(bucket: string, path: string) {
      store.delete(`${bucket}/${path}`);
    },
    publicUrl: (bucket: string, path: string) => `https://storage.test/${bucket}/${path}`,
  }),
  createAssetSignedUpload: vi.fn(),
  createAssetSignedDownload: vi.fn(async (bucket: string, path: string) => `https://signed.test/${bucket}/${path}?token=t`),
  createCadSignedUpload: vi.fn(),
  cadObjectPath: vi.fn(),
  downloadCadObject: vi.fn(),
  PRODUCT_IMAGES_BUCKET: "product-images",
  PRODUCT_DOCUMENTS_BUCKET: "product-documents",
  CAD_MODELS_BUCKET: "cad-models",
  CAD_MAX_BYTES: 25 * 1024 * 1024,
}));

const PDF_BYTES = (tag: string) => new TextEncoder().encode(`%PDF-1.4\n% ${tag}\n%%EOF\n`);
const PNG_BYTES = (tag: string) =>
  Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(tag)]);
const JPEG_BYTES = (tag: string) =>
  Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);
const EXE_BYTES = () => new TextEncoder().encode("MZ\x90\x00 this is definitely not a pdf");

const BUCKET_FOR: Record<string, string> = {
  primary_image: "product-images",
  gallery: "product-images",
  tear_sheet: "product-documents",
  assembly: "product-documents",
  care_guide: "product-documents",
  warranty: "product-documents",
};

/** Simulates the browser PUT: stores bytes at a key shaped like the signer's. */
function upload(kind: string, ext: string, bytes: Uint8Array, contentType: string | null = null, rev = 1): string {
  const path = `${SKU}/${kind}/${rev}-${randomBytes(8).toString("hex")}.${ext}`;
  store.set(`${BUCKET_FOR[kind]}/${path}`, { bytes, contentType });
  return path;
}
const hasObject = (kind: string, path: string) => store.has(`${BUCKET_FOR[kind]}/${path}`);

describe("confirmAsset: magic bytes, sha256 and revision engine", () => {
  const db = getDb();

  const cleanup = async () => {
    await db.delete(product_assets).where(eq(product_assets.global_sku, SKU));
    await db.delete(finished_goods_catalog).where(eq(finished_goods_catalog.global_sku, SKU));
    await db.delete(pim_audit_log).where(eq(pim_audit_log.global_sku, SKU));
  };

  beforeAll(async () => {
    await cleanup();
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, SKU));
    await db.insert(sku_mappings).values({
      global_sku: SKU,
      product_origin: "manufactured",
      category: "ZZV-CNF",
      item_type: "finished_good",
      original_name: "Asset confirm fixture",
      source_file: "tests/confirm-asset.test.ts",
      is_active: true,
    });
  });

  afterAll(async () => {
    await cleanup();
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, SKU));
  });

  beforeEach(async () => {
    store.clear();
    await cleanup();
  });

  const rows = (kind: string) =>
    db
      .select()
      .from(product_assets)
      .where(and(eq(product_assets.global_sku, SKU), eq(product_assets.kind, kind as never)));

  describe("magic-byte rejection", () => {
    it("rejects an executable renamed to .pdf, deletes the object, writes no row", async () => {
      const path = upload("tear_sheet", "pdf", EXE_BYTES(), "application/pdf");
      await expect(
        confirmAsset({ globalSku: SKU, kind: "tear_sheet", storagePath: path, originalFilename: "sheet.pdf" }),
      ).rejects.toThrow(/not a valid PDF/);
      expect(hasObject("tear_sheet", path)).toBe(false);
      expect(await rows("tear_sheet")).toHaveLength(0);
    });

    it("rejects a PNG renamed to .pdf", async () => {
      const path = upload("assembly", "pdf", PNG_BYTES("x"));
      await expect(
        confirmAsset({ globalSku: SKU, kind: "assembly", storagePath: path, originalFilename: "assembly.pdf" }),
      ).rejects.toThrow(/PNG, which does not match the \.pdf extension/);
      expect(await rows("assembly")).toHaveLength(0);
    });

    it("rejects a PDF renamed to .jpg and a PNG renamed to .jpg", async () => {
      const pdfAsJpg = upload("primary_image", "jpg", PDF_BYTES("x"));
      await expect(
        confirmAsset({ globalSku: SKU, kind: "primary_image", storagePath: pdfAsJpg, originalFilename: "hero.jpg" }),
      ).rejects.toThrow(/PDF, which does not match the \.jpg extension/);

      const pngAsJpg = upload("gallery", "jpg", PNG_BYTES("x"));
      await expect(
        confirmAsset({ globalSku: SKU, kind: "gallery", storagePath: pngAsJpg, originalFilename: "g.jpg" }),
      ).rejects.toThrow(/PNG, which does not match the \.jpg extension/);

      expect(await rows("primary_image")).toHaveLength(0);
      expect(await rows("gallery")).toHaveLength(0);
    });

    it("rejects empty files and a declared content-type that contradicts the bytes", async () => {
      const empty = upload("care_guide", "pdf", new Uint8Array());
      await expect(
        confirmAsset({ globalSku: SKU, kind: "care_guide", storagePath: empty, originalFilename: "c.pdf" }),
      ).rejects.toThrow(/empty/);

      const lying = upload("warranty", "pdf", PDF_BYTES("w"), "image/png");
      await expect(
        confirmAsset({ globalSku: SKU, kind: "warranty", storagePath: lying, originalFilename: "w.pdf" }),
      ).rejects.toThrow(/Content type image\/png/);
      expect(hasObject("warranty", lying)).toBe(false);
    });

    it("never touches an object whose key was not issued for this sku/kind", async () => {
      const foreign = `FIN-OTHER-SKU/tear_sheet/1-${randomBytes(8).toString("hex")}.pdf`;
      store.set(`product-documents/${foreign}`, { bytes: PDF_BYTES("f"), contentType: null });
      await expect(
        confirmAsset({ globalSku: SKU, kind: "tear_sheet", storagePath: foreign, originalFilename: "f.pdf" }),
      ).rejects.toThrow("Invalid storage path");
      expect(store.has(`product-documents/${foreign}`)).toBe(true);

      await expect(
        confirmAsset({
          globalSku: SKU,
          kind: "tear_sheet",
          storagePath: `${SKU}/tear_sheet/../../x.pdf`,
          originalFilename: "x.pdf",
        }),
      ).rejects.toThrow("Invalid storage path");
    });

    it("rejects a confirm for an object that was never uploaded", async () => {
      await expect(
        confirmAsset({
          globalSku: SKU,
          kind: "tear_sheet",
          storagePath: `${SKU}/tear_sheet/1-${randomBytes(8).toString("hex")}.pdf`,
          originalFilename: "ghost.pdf",
        }),
      ).rejects.toThrow("not found in storage");
    });
  });

  describe("sha256", () => {
    it("stores the sha256 of the uploaded bytes", async () => {
      const bytes = PDF_BYTES("hash-me");
      const path = upload("tear_sheet", "pdf", bytes, "application/pdf");
      const res = await confirmAsset({
        globalSku: SKU,
        kind: "tear_sheet",
        storagePath: path,
        originalFilename: "sheet.pdf",
      });
      const expected = createHash("sha256").update(bytes).digest("hex");
      expect(res.sha256).toBe(expected);
      const [row] = await rows("tear_sheet");
      expect(row.sha256).toBe(expected);
      expect(row.byte_size).toBe(bytes.length);
      expect(row.content_type).toBe("application/pdf");
    });
  });

  describe("revision engine", () => {
    it("increments revision and supersedes the previous current row", async () => {
      const p1 = upload("tear_sheet", "pdf", PDF_BYTES("one"), "application/pdf", 1);
      const r1 = await confirmAsset({ globalSku: SKU, kind: "tear_sheet", storagePath: p1, originalFilename: "a.pdf" });
      expect(r1.revision).toBe(1);
      expect(r1.isCurrent).toBe(true);
      expect(r1.supersededId).toBeNull();

      const p2 = upload("tear_sheet", "pdf", PDF_BYTES("two"), "application/pdf", 2);
      const r2 = await confirmAsset({ globalSku: SKU, kind: "tear_sheet", storagePath: p2, originalFilename: "b.pdf" });
      expect(r2.revision).toBe(2);
      expect(r2.supersededId).toBe(r1.id);
      expect(r2.supersededRevision).toBe(1);

      const p3 = upload("tear_sheet", "pdf", PDF_BYTES("three"), "application/pdf", 3);
      const r3 = await confirmAsset({ globalSku: SKU, kind: "tear_sheet", storagePath: p3, originalFilename: "c.pdf" });
      expect(r3.revision).toBe(3);

      const all = (await rows("tear_sheet")).sort((a, b) => a.revision - b.revision);
      expect(all.map((r) => r.revision)).toEqual([1, 2, 3]);
      expect(all.map((r) => r.is_current)).toEqual([false, false, true]);
      expect(all[0].superseded_at).toBeInstanceOf(Date);
      expect(all[1].superseded_at).toBeInstanceOf(Date);
      expect(all[2].superseded_at).toBeNull();
      // Superseded revisions keep their stored object (history is downloadable).
      expect(hasObject("tear_sheet", p1)).toBe(true);
      expect(hasObject("tear_sheet", p2)).toBe(true);
    });

    it("keeps revision counters independent per kind", async () => {
      const a = await confirmAsset({
        globalSku: SKU,
        kind: "assembly",
        storagePath: upload("assembly", "pdf", PDF_BYTES("a")),
        originalFilename: "a.pdf",
      });
      const w = await confirmAsset({
        globalSku: SKU,
        kind: "warranty",
        storagePath: upload("warranty", "pdf", PDF_BYTES("w")),
        originalFilename: "w.pdf",
      });
      expect(a.revision).toBe(1);
      expect(w.revision).toBe(1);
      expect((await rows("assembly"))[0].is_current).toBe(true);
    });

    it("leaves the previous revision untouched when the new upload fails the sniff", async () => {
      const good = await confirmAsset({
        globalSku: SKU,
        kind: "care_guide",
        storagePath: upload("care_guide", "pdf", PDF_BYTES("good")),
        originalFilename: "care.pdf",
      });
      await expect(
        confirmAsset({
          globalSku: SKU,
          kind: "care_guide",
          storagePath: upload("care_guide", "pdf", EXE_BYTES(), null, 2),
          originalFilename: "care2.pdf",
        }),
      ).rejects.toThrow(/not a valid PDF/);
      const all = await rows("care_guide");
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(good.id);
      expect(all[0].is_current).toBe(true);
      expect(all[0].superseded_at).toBeNull();
    });

    it("never produces two current rows when confirms race", async () => {
      const inputs = [1, 2, 3, 4].map((n) => ({
        globalSku: SKU,
        kind: "tear_sheet",
        storagePath: upload("tear_sheet", "pdf", PDF_BYTES(`race-${n}`), null, n),
        originalFilename: `race-${n}.pdf`,
      }));
      const results = await Promise.all(inputs.map((i) => confirmAsset(i)));
      expect(new Set(results.map((r) => r.revision)).size).toBe(4);
      const all = await rows("tear_sheet");
      expect(all.filter((r) => r.is_current)).toHaveLength(1);
      expect(all.find((r) => r.is_current)!.revision).toBe(4);
    });

    it("gallery uploads skip revision/supersede: every image stays current", async () => {
      const g1 = await confirmAsset({
        globalSku: SKU,
        kind: "gallery",
        storagePath: upload("gallery", "png", PNG_BYTES("1")),
        originalFilename: "g1.png",
      });
      const g2 = await confirmAsset({
        globalSku: SKU,
        kind: "gallery",
        storagePath: upload("gallery", "webp", Uint8Array.from([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WEBP")])),
        originalFilename: "g2.webp",
      });
      expect(g1.supersededId).toBeNull();
      expect(g2.supersededId).toBeNull();
      const all = await rows("gallery");
      expect(all).toHaveLength(2);
      expect(all.every((r) => r.is_current && r.superseded_at === null)).toBe(true);
      expect(new Set(all.map((r) => r.sort_order)).size).toBe(2);
    });

    it("primary_image replace updates the catalog image_url to the new revision", async () => {
      const first = await confirmAsset({
        globalSku: SKU,
        kind: "primary_image",
        storagePath: upload("primary_image", "jpg", JPEG_BYTES("1"), "image/jpeg", 1),
        originalFilename: "hero.jpg",
      });
      const second = await confirmAsset({
        globalSku: SKU,
        kind: "primary_image",
        storagePath: upload("primary_image", "png", PNG_BYTES("2"), "image/png", 2),
        originalFilename: "hero2.png",
      });
      expect(second.revision).toBe(2);
      expect(second.supersededId).toBe(first.id);
      const [cat] = await db
        .select()
        .from(finished_goods_catalog)
        .where(eq(finished_goods_catalog.global_sku, SKU));
      expect(cat.image_url).toBe(`https://storage.test/product-images/${second.storagePath}`);
    });
  });

  describe("superseded revisions stay viewable", () => {
    it("returns a working URL for EVERY revision (signed for private documents)", async () => {
      const p1 = upload("warranty", "pdf", PDF_BYTES("w1"), "application/pdf", 1);
      await confirmAsset({ globalSku: SKU, kind: "warranty", storagePath: p1, originalFilename: "w1.pdf" });
      const p2 = upload("warranty", "pdf", PDF_BYTES("w2"), "application/pdf", 2);
      await confirmAsset({ globalSku: SKU, kind: "warranty", storagePath: p2, originalFilename: "w2.pdf" });

      const list = (await getProductAssets(SKU)).filter((a) => a.kind === "warranty");
      expect(list).toHaveLength(2);
      const old = list.find((a) => !a.isCurrent)!;
      const cur = list.find((a) => a.isCurrent)!;
      expect(old.revision).toBe(1);
      expect(old.url).toBe(`https://signed.test/product-documents/${p1}?token=t`);
      expect(cur.url).toBe(`https://signed.test/product-documents/${p2}?token=t`);
    });

    it("uses the public URL for superseded images", async () => {
      const p1 = upload("primary_image", "png", PNG_BYTES("a"), "image/png", 1);
      await confirmAsset({ globalSku: SKU, kind: "primary_image", storagePath: p1, originalFilename: "a.png" });
      await confirmAsset({
        globalSku: SKU,
        kind: "primary_image",
        storagePath: upload("primary_image", "png", PNG_BYTES("b"), "image/png", 2),
        originalFilename: "b.png",
      });
      const old = (await getProductAssets(SKU)).find((a) => a.kind === "primary_image" && !a.isCurrent)!;
      expect(old.url).toBe(`https://storage.test/product-images/${p1}`);
    });
  });

  describe("gallery maintenance", () => {
    async function addGallery(name: string, alt?: string) {
      return confirmAsset({
        globalSku: SKU,
        kind: "gallery",
        storagePath: upload("gallery", "png", PNG_BYTES(name)),
        originalFilename: `${name}.png`,
        altText: alt,
      });
    }

    it("returns gallery rows in sort_order and stores upload-time alt text", async () => {
      const a = await addGallery("a", "front view");
      const b = await addGallery("b");
      const c = await addGallery("c");
      // Operator-visible order is driven by sort_order, not insertion luck.
      await db.update(product_assets).set({ sort_order: 1 }).where(eq(product_assets.id, c.id));
      await db.update(product_assets).set({ sort_order: 2 }).where(eq(product_assets.id, a.id));
      await db.update(product_assets).set({ sort_order: 3 }).where(eq(product_assets.id, b.id));

      const gallery = (await getProductAssets(SKU)).filter((x) => x.kind === "gallery");
      expect(gallery.map((g) => g.id)).toEqual([c.id, a.id, b.id]);
      expect(gallery.find((g) => g.id === a.id)!.altText).toBe("front view");
    });

    it("deletes one gallery image (row + object) and leaves the others", async () => {
      const a = await addGallery("a");
      const b = await addGallery("b");
      await deleteGalleryAsset({ globalSku: SKU, assetId: a.id });
      expect(hasObject("gallery", a.storagePath)).toBe(false);
      expect(hasObject("gallery", b.storagePath)).toBe(true);
      const left = await rows("gallery");
      expect(left.map((r) => r.id)).toEqual([b.id]);
    });

    it("refuses to delete a revisioned asset, a missing id, or another SKU's asset", async () => {
      const doc = await confirmAsset({
        globalSku: SKU,
        kind: "tear_sheet",
        storagePath: upload("tear_sheet", "pdf", PDF_BYTES("t")),
        originalFilename: "t.pdf",
      });
      await expect(deleteGalleryAsset({ globalSku: SKU, assetId: doc.id })).rejects.toThrow("Gallery image not found");
      expect(await rows("tear_sheet")).toHaveLength(1);
      expect(hasObject("tear_sheet", doc.storagePath)).toBe(true);

      await expect(
        deleteGalleryAsset({ globalSku: SKU, assetId: "00000000-0000-4000-8000-000000000000" }),
      ).rejects.toThrow("Gallery image not found");
      await expect(deleteGalleryAsset({ globalSku: SKU, assetId: "not-a-uuid" })).rejects.toThrow();

      const g = await addGallery("g");
      await expect(deleteGalleryAsset({ globalSku: "FIN-OTHER-SKU", assetId: g.id })).rejects.toThrow(
        "Gallery image not found",
      );
      expect(await rows("gallery")).toHaveLength(1);
    });

    it("updates and clears alt text on gallery images, and rejects documents / over-length text", async () => {
      const g = await addGallery("g");
      expect((await updateAssetAltText({ globalSku: SKU, assetId: g.id, altText: "  Side   profile  " })).altText).toBe(
        "Side profile",
      );
      expect((await rows("gallery"))[0].alt_text).toBe("Side profile");
      expect((await updateAssetAltText({ globalSku: SKU, assetId: g.id, altText: "   " })).altText).toBeNull();
      expect((await rows("gallery"))[0].alt_text).toBeNull();

      await expect(updateAssetAltText({ globalSku: SKU, assetId: g.id, altText: "x".repeat(301) })).rejects.toThrow(
        /limited to 300/,
      );

      const doc = await confirmAsset({
        globalSku: SKU,
        kind: "assembly",
        storagePath: upload("assembly", "pdf", PDF_BYTES("a")),
        originalFilename: "a.pdf",
      });
      await expect(updateAssetAltText({ globalSku: SKU, assetId: doc.id, altText: "nope" })).rejects.toThrow(
        "Image not found",
      );
    });
  });
});

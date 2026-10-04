import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { requestAssetUpload } from "@/app/embed/admin/master-catalog/actions";
import { getDb } from "@/server/db/client";
import { sku_mappings } from "@/server/db/schema";

const SKU = "FIN-ZZV-AST-1X1";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock("@/lib/pim-audit", async (orig) => ({
  ...(await orig<typeof import("@/lib/pim-audit")>()),
  getPimSession: vi.fn().mockResolvedValue({ email: "test@ccpatio.com", name: "Test Operator" }),
  logPimAudit: vi.fn().mockResolvedValue(undefined),
}));

// Don't hit the Supabase API; the signer only needs to echo the server-chosen key.
vi.mock("@/lib/supabase-storage", () => ({
  createAssetSignedUpload: vi.fn(async ({ bucket, path }: { bucket: string; path: string }) => ({
    path,
    token: "mock-token",
    signedUrl: `https://example.test/${bucket}/${path}`,
  })),
  createAssetSignedDownload: vi.fn(),
  getVaultStorage: vi.fn(),
  createCadSignedUpload: vi.fn(),
  createCadObjectPath: vi.fn(),
  cadObjectPath: vi.fn(),
  downloadCadObject: vi.fn(),
  PRODUCT_IMAGES_BUCKET: "product-images",
  PRODUCT_DOCUMENTS_BUCKET: "product-documents",
  CAD_MODELS_BUCKET: "cad-models",
  CAD_MAX_BYTES: 25 * 1024 * 1024,
}));

describe("Zero-Trust Asset Upload Signer (requestAssetUpload)", () => {
  const db = getDb();

  beforeAll(async () => {
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, SKU));
    await db.insert(sku_mappings).values({
      global_sku: SKU,
      product_origin: "manufactured",
      category: "ZZV-AST",
      item_type: "finished_good",
      original_name: "Asset signer fixture",
      source_file: "tests/asset-vault.test.ts",
      is_active: true,
    });
  });

  afterAll(async () => {
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, SKU));
  });

  beforeEach(async () => {
    const { createAssetSignedUpload } = await import("@/lib/supabase-storage");
    vi.mocked(createAssetSignedUpload).mockClear();
  });

  it("rejects buckets outside the allowlist", async () => {
    await expect(
      requestAssetUpload({ globalSku: SKU, kind: "primary_image", filename: "a.jpg", bucket: "unauthorized-bucket" }),
    ).rejects.toThrow("Invalid bucket requested");
    await expect(
      requestAssetUpload({ globalSku: SKU, kind: "tear_sheet", filename: "a.pdf", bucket: "cad-models" }),
    ).rejects.toThrow("Invalid bucket requested");
  });

  it("rejects an allowlisted bucket that is wrong for the asset kind", async () => {
    await expect(
      requestAssetUpload({ globalSku: SKU, kind: "primary_image", filename: "a.jpg", bucket: "product-documents" }),
    ).rejects.toThrow("Invalid bucket requested");
  });

  it("rejects disallowed extensions, including double-extension tricks", async () => {
    for (const filename of ["malware.exe", "script.sh", "manual.pdf.exe", "noext", ".jpg", "image.svg"]) {
      await expect(
        requestAssetUpload({ globalSku: SKU, kind: "gallery", filename }),
      ).rejects.toThrow("Invalid file extension");
    }
    // A PDF kind may not take an image extension and vice-versa.
    await expect(requestAssetUpload({ globalSku: SKU, kind: "tear_sheet", filename: "a.png" })).rejects.toThrow(
      "Invalid file extension",
    );
    await expect(requestAssetUpload({ globalSku: SKU, kind: "primary_image", filename: "a.pdf" })).rejects.toThrow(
      "Invalid file extension",
    );
  });

  it("rejects unknown kinds and unknown SKUs", async () => {
    await expect(requestAssetUpload({ globalSku: SKU, kind: "cad_model", filename: "a.jpg" })).rejects.toThrow(
      "Invalid asset kind",
    );
    await expect(
      requestAssetUpload({ globalSku: "FIN-NOPE-NOPE-0X0", kind: "primary_image", filename: "a.jpg" }),
    ).rejects.toThrow("Unknown product SKU");
  });

  it("rejects SKUs that try to escape the key prefix", async () => {
    await expect(
      requestAssetUpload({ globalSku: "../FIN-X", kind: "primary_image", filename: "a.jpg" }),
    ).rejects.toThrow("Invalid SKU for asset path");
  });

  it("strips / \\ .. from filenames and always signs a server-generated key", async () => {
    const { createAssetSignedUpload } = await import("@/lib/supabase-storage");
    const mockCreate = vi.mocked(createAssetSignedUpload);

    const a = await requestAssetUpload({ globalSku: SKU, kind: "primary_image", filename: "../../../etc/passwd.jpg" });
    expect(a.filename).toBe("passwd.jpg");
    expect(a.bucket).toBe("product-images");
    expect(a.path).toMatch(new RegExp(`^${SKU}/primary_image/1-[a-f0-9]{16}\\.jpg$`));
    expect(a.path).not.toContain("passwd");

    const b = await requestAssetUpload({ globalSku: SKU, kind: "tear_sheet", filename: "C:\\evil\\..\\shell.pdf" });
    expect(b.filename).toBe("shell.pdf");
    expect(b.bucket).toBe("product-documents");
    expect(b.path).toMatch(new RegExp(`^${SKU}/tear_sheet/1-[a-f0-9]{16}\\.pdf$`));

    for (const call of mockCreate.mock.calls) {
      const { path } = call[0] as { path: string };
      expect(path).not.toMatch(/\.\.|\\/);
    }
  });

  it("derives the bucket from the kind when none is supplied and randomises the key", async () => {
    const first = await requestAssetUpload({ globalSku: SKU, kind: "warranty", filename: "w.pdf" });
    const second = await requestAssetUpload({ globalSku: SKU, kind: "warranty", filename: "w.pdf" });
    expect(first.bucket).toBe("product-documents");
    expect(first.path).not.toBe(second.path);
  });

  it("enforces the per-kind size limit when a size is declared", async () => {
    await expect(
      requestAssetUpload({ globalSku: SKU, kind: "primary_image", filename: "a.jpg", byteSize: 16 * 1024 * 1024 }),
    ).rejects.toThrow("exceeds");
  });
});

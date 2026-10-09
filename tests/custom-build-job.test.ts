import { expect, test, describe, beforeAll, afterAll } from "vitest";
import { getDb } from "../src/server/db/client";
import { mintCustomJob } from "../src/server/factory-bom/mint-custom-job";
import { sku_mappings, custom_build_jobs } from "../src/server/db/schema";
import { eq, like } from "drizzle-orm";

describe("mintCustomJob", () => {
  const db = getDb();

  beforeAll(async () => {
    // clean up
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, "JOB-TEST-MINT"));
    await db.delete(sku_mappings).where(eq(sku_mappings.global_sku, "JOB-TEST-MINT-02"));
    await db.delete(custom_build_jobs).where(eq(custom_build_jobs.client_slug, "TEST"));
  });

  test("mints a valid JOB- SKU and job header", async () => {
    const result = await mintCustomJob({
      clientSlug: "TEST",
      itemSlug: "MINT",
      displayName: "Test Client",
      createdBy: "test@example.com",
    }, db);

    expect(result.globalSku).toBe("JOB-TEST-MINT");
    expect(result.jobId).toBeDefined();

    const row = await db.query.sku_mappings.findFirst({
      where: eq(sku_mappings.global_sku, "JOB-TEST-MINT"),
    });

    expect(row).toBeDefined();
    expect(row?.product_origin).toBeNull();
    expect(row?.sync_to_woo).toBe(false);
    expect(row?.sync_to_clover).toBe(false);
    expect((row?.attributes as any)?.custom_build).toBe(true);
  });

  test("handles collisions with suffixes", async () => {
    const result2 = await mintCustomJob({
      clientSlug: "TEST",
      itemSlug: "MINT",
      displayName: "Test Client",
      createdBy: "test@example.com",
    }, db);

    expect(result2.globalSku).toBe("JOB-TEST-MINT-02");
  });

  test("rejects FIN- SKUs on Path A", async () => {
    await expect(mintCustomJob({
      clientSlug: "FIN-TEST",
      itemSlug: "MINT",
      displayName: "Test",
      createdBy: "test@example.com",
    }, db)).rejects.toThrow(/FIN- SKU/);
  });

  test("enforces length and character limits", async () => {
    // Clean up first to avoid collisions with previous runs
    await db.delete(sku_mappings).where(like(sku_mappings.global_sku, "JOB-VERYLONG%"));
    await db.delete(custom_build_jobs).where(eq(custom_build_jobs.client_slug, "VERYLONGCLIENTNA"));

    const result = await mintCustomJob({
      clientSlug: "VERYLONGCLIENTNAMEEXCEEDS16CHARS",
      itemSlug: "REALLY-LONG-ITEM-NAME-THAT-EXCEEDS-24-CHARS",
      displayName: "Test Client",
      createdBy: "test@example.com",
    }, db);

    // Should truncate
    expect(result.globalSku).toBe("JOB-VERYLONGCLIENTNA-REALLY-LONG-ITEM-NAME-TH");
    expect(result.globalSku.length).toBeLessThanOrEqual(65);
    expect(/^[A-Z0-9][A-Z0-9-]{2,64}$/.test(result.globalSku)).toBe(true);
  });
});

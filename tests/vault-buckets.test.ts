import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";

/**
 * Read-only guard for the zero-trust storage configuration applied by
 * `npx tsx scripts/setup-vault-buckets.ts` (supabase/migrations/20261004190000_*.sql).
 * Fails the lifecycle if someone re-grants client writes or drifts the limits.
 */
describe("Vault storage buckets (zero-trust configuration)", () => {
  const db = getDb();

  async function buckets() {
    return (await db.execute(sql`
      select id, public, file_size_limit::text as file_size_limit, allowed_mime_types
      from storage.buckets
      where id in ('product-images', 'product-documents')
    `)) as unknown as { id: string; public: boolean; file_size_limit: string; allowed_mime_types: string[] | null }[];
  }

  it("product-images is public and capped at 15 MiB (matches the vault's image limit)", async () => {
    const b = (await buckets()).find((x) => x.id === "product-images");
    expect(b).toBeDefined();
    expect(b!.public).toBe(true);
    expect(b!.file_size_limit).toBe(String(15 * 1024 * 1024));
  });

  it("product-documents exists, is PRIVATE, 25 MiB, application/pdf only", async () => {
    const b = (await buckets()).find((x) => x.id === "product-documents");
    expect(b).toBeDefined();
    expect(b!.public).toBe(false);
    expect(b!.file_size_limit).toBe(String(25 * 1024 * 1024));
    expect(b!.allowed_mime_types).toEqual(["application/pdf"]);
  });

  it("no client (anon/authenticated/public) INSERT/UPDATE/DELETE/ALL policy touches a vault bucket", async () => {
    const rows = (await db.execute(sql`
      select policyname, cmd, roles::text as roles
      from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%product-images%'
          or coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%product-documents%'
          or coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%cad-models%')
    `)) as unknown as { policyname: string; cmd: string; roles: string }[];
    expect(rows).toEqual([]);
  });

  it("product-documents has no client read policy either (signed URLs only)", async () => {
    const rows = (await db.execute(sql`
      select policyname from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%product-documents%'
    `)) as unknown as { policyname: string }[];
    expect(rows).toEqual([]);
  });
});

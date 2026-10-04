/**
 * Idempotent setup + verification for the Asset Vault storage buckets.
 * Applies supabase/migrations/20261004190000_vault_buckets_zero_trust.sql (the single
 * source of truth for local `supabase db reset` too) via POSTGRES_URL, then asserts:
 *   - product-images:    public, 15 MiB
 *   - product-documents: private, 25 MiB, application/pdf only
 *   - NO anon/authenticated INSERT/UPDATE/DELETE/ALL policy touches a vault bucket
 * Exits non-zero if any assertion fails.
 *
 * Usage: npx tsx scripts/setup-vault-buckets.ts
 */
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";

loadEnvConfig(path.resolve(process.cwd()));

const url = process.env.POSTGRES_URL;
if (!url) {
  throw new Error("POSTGRES_URL is not set (run from repo root with .env.local)");
}

const sqlFile = path.resolve(
  process.cwd(),
  "supabase/migrations/20261004190000_vault_buckets_zero_trust.sql",
);

const sql = postgres(url, { prepare: false, max: 1 });

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main(): Promise<void> {
  await sql.unsafe(fs.readFileSync(sqlFile, "utf8"));

  const buckets = await sql<
    { id: string; public: boolean; file_size_limit: string | null; allowed_mime_types: string[] | null }[]
  >`
    select id, public, file_size_limit::text, allowed_mime_types
    from storage.buckets
    where id in ('product-images', 'product-documents', 'cad-models')
    order by id
  `;
  const policies = await sql<{ policyname: string; cmd: string; roles: string }[]>`
    select policyname, cmd, roles::text as roles
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like '%product-images%' or policyname like '%product-documents%' or policyname like '%cad-models%'
           or coalesce(qual, '') || coalesce(with_check, '') like '%product-%'
           or coalesce(qual, '') || coalesce(with_check, '') like '%cad-models%')
    order by policyname
  `;
  console.log("buckets:", buckets);
  console.log("policies:", policies);

  const images = buckets.find((b) => b.id === "product-images");
  const docs = buckets.find((b) => b.id === "product-documents");
  assert(!!images && images.public === true, "product-images must exist and be public");
  assert(images!.file_size_limit === String(15 * 1024 * 1024), "product-images limit must be 15 MiB");
  assert(!!docs && docs.public === false, "product-documents must exist and be private");
  assert(docs!.file_size_limit === String(25 * 1024 * 1024), "product-documents limit must be 25 MiB");
  assert(
    docs!.allowed_mime_types?.length === 1 && docs!.allowed_mime_types[0] === "application/pdf",
    "product-documents must allow application/pdf only",
  );
  const writes = policies.filter((p) => p.cmd !== "SELECT");
  assert(writes.length === 0, `client write policies remain: ${writes.map((p) => p.policyname).join(", ")}`);
  assert(
    !policies.some((p) => /product-documents/.test(p.policyname)),
    "product-documents must have no client policies at all",
  );
  console.log("OK: vault buckets configured and client writes are revoked.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });

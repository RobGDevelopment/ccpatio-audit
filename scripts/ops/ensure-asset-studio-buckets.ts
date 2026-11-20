/**
 * Idempotent setup + verification for the Asset Studio storage buckets.
 * Applies supabase/migrations/20261120000000_asset_studio_buckets.sql via POSTGRES_URL, then asserts:
 *   - product-images:    public, 25 MiB
 *   - cad-models:        public, 100 MiB, allows model/gltf-binary + model/vnd.usdz+zip
 *   - product-documents: private, 25 MiB, application/pdf only (unchanged)
 *   - NO anon/authenticated INSERT/UPDATE/DELETE/ALL policy touches an asset bucket
 * Exits non-zero if any assertion fails.
 *
 * Usage: npx tsx scripts/ops/ensure-asset-studio-buckets.ts
 */
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import path from "node:path";
import { ensureAssetStudioBuckets } from "../../src/server/assets/ensure-buckets";

loadEnvConfig(path.resolve(process.cwd()));

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main(): Promise<void> {
  const { buckets } = await ensureAssetStudioBuckets();
  console.log("buckets:", buckets);

  const images = buckets.find((b) => b.id === "product-images");
  const cad = buckets.find((b) => b.id === "cad-models");
  const docs = buckets.find((b) => b.id === "product-documents");
  assert(!!images && images.public === true, "product-images must exist and be public");
  assert(images!.file_size_limit === String(25 * 1024 * 1024), "product-images limit must be 25 MiB");
  assert(
    !!images!.allowed_mime_types?.includes("image/jpeg") &&
      images!.allowed_mime_types.includes("application/octet-stream"),
    "product-images must allow images + application/octet-stream",
  );
  assert(!!cad && cad.public === true, "cad-models must exist and be public");
  assert(cad!.file_size_limit === String(100 * 1024 * 1024), "cad-models limit must be 100 MiB");
  for (const mime of ["model/gltf-binary", "model/gltf+json", "model/vnd.usdz+zip", "application/octet-stream"]) {
    assert(!!cad!.allowed_mime_types?.includes(mime), `cad-models must allow ${mime}`);
  }
  assert(!!docs && docs.public === false, "product-documents must exist and be private");
  assert(
    docs!.allowed_mime_types?.length === 1 && docs!.allowed_mime_types[0] === "application/pdf",
    "product-documents must allow application/pdf only",
  );

  const url = process.env.POSTGRES_URL!;
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const policies = await sql<{ policyname: string; cmd: string; roles: string }[]>`
      select policyname, cmd, roles::text as roles
      from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '(product-images|cad-models|product-documents)'
      order by policyname
    `;
    console.log("policies:", policies);
    const writes = policies.filter((p) => p.cmd !== "SELECT");
    assert(writes.length === 0, `client write policies remain: ${writes.map((p) => p.policyname).join(", ")}`);
    assert(
      policies.some((p) => p.policyname === "Public read cad-models"),
      "Public read cad-models policy must exist",
    );
    assert(
      policies.some((p) => p.policyname === "Public read product-images"),
      "Public read product-images policy must exist",
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.log("OK: asset studio buckets configured; client writes remain revoked.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

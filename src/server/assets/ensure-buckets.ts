import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

export const ASSET_STUDIO_BUCKETS_SQL_PATH = "supabase/migrations/20261120000000_asset_studio_buckets.sql";

export type AssetStudioBucketState = {
  id: string;
  public: boolean;
  file_size_limit: string | null;
  allowed_mime_types: string[] | null;
};

export type EnsureAssetStudioBucketsResult = {
  buckets: AssetStudioBucketState[];
};

/**
 * Idempotently applies the Asset Studio bucket migration (product-images 25 MiB public,
 * cad-models 100 MiB public, product-documents private/pdf) via POSTGRES_URL, then reads
 * the resulting bucket config back. Safe to call repeatedly (seed script, API, CI).
 * Never grants anon/authenticated writes - uploads are server-signed only.
 */
export async function ensureAssetStudioBuckets(): Promise<EnsureAssetStudioBucketsResult> {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL is not set (cannot ensure asset studio buckets)");
  }
  const sqlFile = path.resolve(process.cwd(), ASSET_STUDIO_BUCKETS_SQL_PATH);
  const ddl = fs.readFileSync(sqlFile, "utf8");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql.unsafe(ddl);
    const buckets = await sql<AssetStudioBucketState[]>`
      select id, public, file_size_limit::text, allowed_mime_types
      from storage.buckets
      where id in ('product-images', 'cad-models', 'product-documents')
      order by id
    `;
    return { buckets: [...buckets] };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

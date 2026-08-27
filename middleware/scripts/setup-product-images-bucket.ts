/**
 * One-shot: create product-images bucket + RLS policies via POSTGRES_URL.
 * Usage: npx tsx scripts/setup-product-images-bucket.ts
 */
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";
import path from "node:path";

loadEnvConfig(path.resolve(process.cwd()));

const url = process.env.POSTGRES_URL;
if (!url) {
  throw new Error("POSTGRES_URL is not set (run from middleware/ with .env.local)");
}

const sql = postgres(url, { prepare: false, max: 1 });

async function main(): Promise<void> {
  await sql`
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'product-images',
      'product-images',
      true,
      5242880,
      array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']::text[]
    )
    on conflict (id) do update
    set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types
  `;

  await sql.unsafe(
    `drop policy if exists "Public read product-images" on storage.objects`,
  );
  await sql.unsafe(
    `drop policy if exists "Authenticated upload product-images" on storage.objects`,
  );
  await sql.unsafe(
    `drop policy if exists "Authenticated update product-images" on storage.objects`,
  );

  await sql.unsafe(`
    create policy "Public read product-images"
    on storage.objects
    for select
    to public
    using (bucket_id = 'product-images')
  `);

  await sql.unsafe(`
    create policy "Authenticated upload product-images"
    on storage.objects
    for insert
    to authenticated
    with check (bucket_id = 'product-images')
  `);

  await sql.unsafe(`
    create policy "Authenticated update product-images"
    on storage.objects
    for update
    to authenticated
    using (bucket_id = 'product-images')
    with check (bucket_id = 'product-images')
  `);

  const buckets = await sql`
    select id, name, public, file_size_limit
    from storage.buckets
    where id = 'product-images'
  `;
  const policies = await sql`
    select policyname, cmd, roles::text as roles
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like '%product-images%'
    order by policyname
  `;

  console.log("bucket:", buckets);
  console.log("policies:", policies);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });

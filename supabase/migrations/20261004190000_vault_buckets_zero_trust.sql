-- Zero-trust storage for the Omnichannel Asset Vault (Phase 2 remediation).
--
--   product-images     public read, 15 MiB, jpeg/png/webp (+ legacy gif/avif)
--   product-documents  PRIVATE, 25 MiB, application/pdf only
--   cad-models         private (unchanged config)
--
-- Browsers NEVER write directly. All writes go through server-signed upload URLs
-- (service role, server-generated object key) so no storage.objects policy may grant
-- `anon` / `authenticated` INSERT, UPDATE, DELETE or ALL on these buckets. Any
-- previously-created policy of that kind is dropped by body match (not only by name),
-- so renamed copies cannot survive. This file is idempotent.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-documents',
  'product-documents',
  false,
  26214400,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Revoke every client write policy that touches the vault buckets.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (
        coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%product-images%'
        or coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%product-documents%'
        or coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%cad-models%'
      )
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end
$$;

-- Reads: product-images is public (CDN / <img>); cad-models stays authenticated-read.
-- product-documents has NO client policy: it is private and is only ever read through
-- short-lived signed URLs minted by the server.
drop policy if exists "Public read product-images" on storage.objects;
create policy "Public read product-images"
on storage.objects
for select
to public
using (bucket_id = 'product-images');

drop policy if exists "Authenticated read cad-models" on storage.objects;
create policy "Authenticated read cad-models"
on storage.objects
for select
to authenticated
using (bucket_id = 'cad-models');

-- Public product image bucket for PIM / finished-goods uploads.
-- Public reads; authenticated inserts + updates (upsert support).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read product-images" on storage.objects;
drop policy if exists "Authenticated upload product-images" on storage.objects;
drop policy if exists "Authenticated update product-images" on storage.objects;

-- Anyone can read objects in the public bucket (CDN / <img src>).
create policy "Public read product-images"
on storage.objects
for select
to public
using (bucket_id = 'product-images');

-- Signed-in users can upload new objects.
create policy "Authenticated upload product-images"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'product-images');

-- Upsert / replace requires UPDATE (+ SELECT above).
create policy "Authenticated update product-images"
on storage.objects
for update
to authenticated
using (bucket_id = 'product-images')
with check (bucket_id = 'product-images');

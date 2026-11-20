-- Asset Studio buckets (phase 3d-glb-and-hires-swatch-studio). Idempotent.
--
--   product-images     public read, 25 MiB, images (hi-res swatches / textures / posters)
--   cad-models         public read, 100 MiB, native .glb/.gltf/.usdz for <model-viewer> / AR
--   product-documents  PRIVATE, 25 MiB, application/pdf only (unchanged)
--
-- Browsers NEVER write directly: all writes go through server-signed upload URLs (service
-- role), so NO anon/authenticated INSERT/UPDATE/DELETE/ALL policy is granted here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  26214400,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
    'model/gltf-binary', 'model/gltf+json', 'model/vnd.usdz+zip',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cad-models',
  'cad-models',
  true,
  104857600,
  array[
    'image/jpeg', 'image/png', 'image/webp',
    'model/gltf-binary', 'model/gltf+json', 'model/vnd.usdz+zip',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Keep product-documents private / pdf-only exactly as the vault migration defines it.
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

-- Public SELECT for both asset buckets (CDN / <img> / <model-viewer>).
drop policy if exists "Public read product-images" on storage.objects;
create policy "Public read product-images"
on storage.objects
for select
to public
using (bucket_id = 'product-images');

drop policy if exists "Public read cad-models" on storage.objects;
create policy "Public read cad-models"
on storage.objects
for select
to public
using (bucket_id = 'cad-models');

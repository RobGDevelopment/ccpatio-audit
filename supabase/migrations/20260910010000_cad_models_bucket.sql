-- Private CAD models bucket for Factory BOM drag-drop uploads.
-- Service-role / signed URLs for write; authenticated read of own objects.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cad-models',
  'cad-models',
  false,
  26214400,
  array[
    'model/vnd.collada+xml',
    'application/octet-stream',
    'application/xml',
    'text/xml',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated read cad-models" on storage.objects;
drop policy if exists "Authenticated upload cad-models" on storage.objects;
drop policy if exists "Authenticated update cad-models" on storage.objects;

create policy "Authenticated read cad-models"
on storage.objects
for select
to authenticated
using (bucket_id = 'cad-models');

create policy "Authenticated upload cad-models"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'cad-models');

create policy "Authenticated update cad-models"
on storage.objects
for update
to authenticated
using (bucket_id = 'cad-models')
with check (bucket_id = 'cad-models');

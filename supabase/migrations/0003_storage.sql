-- Vylan — storage bucket for client uploads.
--
-- Bucket layout:
--   firms/{firm_id}/engagements/{engagement_id}/items/{item_id}/{file}
--
-- The bucket is private; all access is via signed URLs minted server-side.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-uploads',
  'client-uploads',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'image/webp'
  ]
)
on conflict (id) do nothing;

-- Only firm members can read objects in their firm's path.
create policy "firm members read own uploads"
on storage.objects for select to authenticated
using (
  bucket_id = 'client-uploads'
  and (storage.foldername(name))[1] = 'firms'
  and (storage.foldername(name))[2]::uuid = public.current_firm_id()
);

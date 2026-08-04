-- A client can have a picture.
--
-- The founder: "theres no way for a client to upload a pfp or even the
-- accountant. Its a redudant circle. Add the ability for a accountant to do it
-- for now in the profile section of the client when they edit them."
--
-- ONE COLUMN, AND IT DELIBERATELY MIRRORS users.avatar_path (0019). The whole
-- upload pipeline already exists — auth, the mime allow-list, the hard byte
-- ceiling, the sharp re-encode to a square, the firm-prefixed storage path and
-- the 24h signed URL — and it is reached through uploadBrandingImage(). A
-- client's picture is a third `kind` on that path, not a second pipeline, so it
-- inherits every one of those protections rather than re-earning them. The
-- reader is the same too: AvatarInitials already takes an optional `src` and
-- falls back to coloured initials, which is exactly what an empty column means.
--
-- WHY A PATH AND NOT A URL. Signed URLs expire. 0059 records that firms.logo_url
-- originally stored a URL and later started storing a PATH, and that a stale row
-- from the old shape made createSignedUrl reject and take the whole page down.
-- Storing the path and minting the URL on read is the shape that survived.
--
-- NO RLS CHANGES. clients already carries firm-scoped RLS plus the private-client
-- cascade, and a column added to that table inherits both. The storage object
-- lives under firms/{firm_id}/clients/{client_id}/ so the bucket's existing
-- firm-prefix policy covers the file itself.
--
-- THE CLIENT CANNOT SET THIS, by design and by the founder's own wording ("for
-- now"). The portal has no write path to this column, so the only way a picture
-- appears is an accountant choosing one. A client-uploaded avatar would need its
-- own magic-link-scoped write policy and a moderation answer, and neither is
-- worth inventing before anybody has asked for it.
--
-- Migration number: 1520 is mine (renumbered off a collision with #1312's
-- 1510_engagement_details.sql) and no number is duplicated per
--   ls supabase/migrations | sed 's/_.*//' | sort | uniq -d
-- which prints nothing. 1530 is the next free one. RE-RUN THAT CHECK AFTER
-- PULLING — a number free when you pick it can be taken before you push, which
-- is precisely what happened to 1510 an hour ago.

alter table clients
  add column if not exists avatar_path text;

comment on column public.clients.avatar_path is
  'Storage path (not a URL) for the client''s picture, under firms/{firm_id}/clients/{client_id}/. Null means fall back to initials. Written only by the firm — the portal has no path to it.';

-- Verify after applying:
--   select count(*) as with_picture from clients where avatar_path is not null;
--
-- Expect 0 until the first picture is uploaded.

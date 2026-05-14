-- Phase 2: user profile.
--
-- Adds two nullable columns on `users` so each member of a firm can manage
-- their own identity inside the app:
--   * avatar_path  — storage path for their avatar JPEG (set by the Phase 1
--                    `uploadBrandingImage(.., "user_avatar")` action)
--   * display_name — preferred name shown in the dropdown / activity feed,
--                    independent of `users.name` (which was set at signup).
--
-- `users.locale` already exists from 0001_init.sql — no second column.
--
-- RLS: users can SELECT their own row (already covered by the firm-scoped
-- `users_select` policy) AND can UPDATE their own row. Service-role still
-- bypasses RLS for the onboarding-bootstrap path (see 0009 + actions/
-- onboarding.ts).

alter table users add column if not exists avatar_path text;
alter table users add column if not exists display_name text;

drop policy if exists users_update_self on users;
create policy users_update_self on users
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

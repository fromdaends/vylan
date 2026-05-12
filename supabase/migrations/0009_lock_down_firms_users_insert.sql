-- Security hardening: remove permissive INSERT policies on firms and users.
--
-- Background: 0002_rls.sql created `firms_insert with check (true)` and
-- `users_insert_self with check (id = auth.uid())` to support the original
-- signup flow. The actual onboarding flow goes through the service-role key
-- on the server (see src/app/actions/onboarding.ts), so these policies are
-- unused — but they let any authenticated user POST directly to PostgREST
-- and create firm/user rows with arbitrary attributes (e.g. plan =
-- 'cabinet_plus'), bypassing billing.
--
-- All legitimate firm / user creation must go through the server-side
-- service-role path. Authenticated users can no longer insert directly.

drop policy if exists firms_insert on firms;
drop policy if exists users_insert_self on users;

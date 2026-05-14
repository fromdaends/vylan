-- Findings A + B from docs/multi-user-audit.md (2026-05-13):
-- The row-level UPDATE policies on `users` (0019_user_profile.sql) and `firms`
-- (0002_rls.sql) gate by row only, not by column. Any authenticated firm
-- member can therefore PATCH any column on a row they own via direct
-- PostgREST, bypassing the TypeScript whitelists in updateUserProfile() and
-- updateCurrentFirm(). Exploitation: (B) self-write users.firm_id to jump
-- into any firm whose UUID is known, and (A) self-write firms.plan and
-- firms.stripe_* to escalate plan or corrupt the Stripe webhook lookup.
--
-- Fix: keep the row-level RLS as-is, and additionally restrict UPDATE to a
-- column whitelist at the SQL grant level. After this migration, a PATCH that
-- targets a non-whitelisted column raises "permission denied for column ..."
-- regardless of which row it targets. The service-role key bypasses this
-- (used by onboarding bootstrap, billing webhook, AI worker) so server-side
-- flows are unaffected.
--
-- The whitelists mirror the existing TypeScript Patch types exactly:
--   users   ← UserProfilePatch   (src/lib/db/users.ts:28-32)
--   firms   ← updateCurrentFirm  (src/lib/db/firms.ts:43-56)

revoke update on public.users from authenticated;
grant update (display_name, avatar_path, locale) on public.users to authenticated;

revoke update on public.firms from authenticated;
grant update (
  name,
  locale_default,
  brand_color,
  timezone,
  business_hours,
  invited_emails,
  onboarded_at,
  auto_reject_unusable_docs
) on public.firms to authenticated;

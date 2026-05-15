-- Phase 3a (firm logo upload).
--
-- 0039 locked down `firms` UPDATE to a column whitelist so a malicious
-- PATCH can't escalate plan or corrupt Stripe state. That whitelist did
-- not include `logo_url` because nothing wrote to it yet — the firm
-- logo column has existed since 0001 but was inert.
--
-- This migration extends the whitelist by re-granting it with `logo_url`
-- appended, so the new firm-logo server action can persist the storage
-- path of the uploaded image. The column stores a storage path (mirrors
-- `users.avatar_path`); signed URLs are minted on read by
-- `getBrandingImageUrl()` in `src/lib/storage.ts`.

revoke update on public.firms from authenticated;
grant update (
  name,
  locale_default,
  brand_color,
  timezone,
  business_hours,
  invited_emails,
  onboarded_at,
  auto_reject_unusable_docs,
  logo_url
) on public.firms to authenticated;

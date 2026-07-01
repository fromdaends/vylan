-- QuickBooks token encryption at rest — supporting column.
--
-- Enables encrypting the stored OAuth access/refresh tokens (AES-256-GCM, see
-- src/lib/quickbooks/token-cipher.ts) without breaking the optimistic-concurrency
-- guard in updateFirmQuickbooksTokens. That guard matches on the refresh token to
-- avoid clobbering a rotated token; once the token is encrypted its ciphertext is
-- non-deterministic (random IV) and can't be matched, so we match on a stable
-- sha256 FINGERPRINT of the plaintext refresh token instead.
--
-- refresh_token_fingerprint = encode(digest(<plaintext refresh token>,'sha256'),'hex').
-- The app computes the identical value (crypto.createHash('sha256')) on every write,
-- and this migration backfills existing rows so there is never a NULL to special-
-- case. It is NOT a secret column (a sha256 of a high-entropy token reveals nothing
-- usable), and the quickbooks_connections table's column-grant whitelist (0410)
-- leaves any un-granted column service-role-only — so no GRANT is needed here.
--
-- Additive + safe: the app degrades gracefully (isMissingSchema) before this lands
-- AND stores tokens as PLAINTEXT until BOTH this column exists and QBO_TOKEN_ENC_KEY
-- is set, so applying this alone changes nothing until the key is configured.

create extension if not exists pgcrypto with schema extensions;

alter table quickbooks_connections
  add column if not exists refresh_token_fingerprint text;

-- Backfill existing (plaintext) rows so the fingerprint match works immediately.
-- Tokens are still plaintext at this point: encryption only activates once the key
-- is set, which is done AFTER this migration.
update quickbooks_connections
set refresh_token_fingerprint =
  encode(extensions.digest(refresh_token, 'sha256'), 'hex')
where refresh_token is not null
  and refresh_token_fingerprint is null;

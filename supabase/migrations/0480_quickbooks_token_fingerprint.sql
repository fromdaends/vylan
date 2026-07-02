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

alter table quickbooks_connections
  add column if not exists refresh_token_fingerprint text;

-- Backfill existing (plaintext) rows so the fingerprint match works immediately.
-- Tokens are still plaintext at this point: encryption only activates once the key
-- is set, which is done AFTER this migration. We use the BUILT-IN sha256(bytea)
-- (core Postgres, PG11+) rather than pgcrypto's digest() so there is no dependency
-- on which schema pgcrypto lives in. convert_to(...,'UTF8') gives the token's UTF-8
-- bytes, so the result matches Node's crypto.createHash('sha256')...digest('hex')
-- exactly (see tokenFingerprint in token-cipher.ts).
update quickbooks_connections
set refresh_token_fingerprint =
  encode(sha256(convert_to(refresh_token, 'UTF8')), 'hex')
where refresh_token is not null
  and refresh_token_fingerprint is null;

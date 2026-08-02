-- Optional per-client PIN for the client portal.
--
-- The portal is link-based by design: no account, no password, and that stays
-- the default story — every column here defaults to OFF. This adds an OPTIONAL
-- gate a firm can switch on for one client at a time: a 6-digit code the
-- accountant shares human-to-human (phone, in person). Vylan never sends the
-- PIN anywhere; a code emailed beside the link it protects would protect
-- nothing.
--
-- WHY THE PIN IS ENCRYPTED AND NOT HASHED.
-- A password gets a slow one-way hash (bcrypt/argon2) and is never recoverable.
-- This one MUST be recoverable: the firm reads it back off the client profile
-- to tell the client what it is, and there is deliberately no self-service
-- reset — the firm IS the reset path. A hash would make the feature impossible.
-- So it is encrypted at rest with AES-256-GCM (see src/lib/portal/pin-cipher.ts,
-- key PORTAL_PIN_ENC_KEY) instead.
--
-- The tradeoff, stated plainly: anyone holding BOTH a database dump AND the
-- app's encryption key can read every PIN. That is accepted because
--   * the key lives only in the app environment, never in the database, so a
--     stolen dump alone yields nothing;
--   * the plaintext never reaches a browser except through one audit-logged
--     reveal action on the firm side;
--   * a PIN on its own is worthless — an attacker still needs the client's
--     private 43-character portal link, which is the primary credential.
-- This is a second factor on a shared link, not a password store.

alter table clients
  add column if not exists portal_pin_enabled boolean not null default false,

  -- AES-256-GCM ciphertext, "pinv1:" prefixed. Never selected into anything
  -- that reaches a browser: loadPortalContext strips it before the portal
  -- renders, and the firm side reads it only through revealPortalPin().
  add column if not exists portal_pin_encrypted text,

  add column if not exists portal_pin_set_at timestamptz,

  -- Per-client signing salt for the "remember this device" cookie. Rotating it
  -- is what invalidates every remembered device at once, which is why BOTH
  -- regenerating the PIN and disabling the feature rotate it. Without this, a
  -- regenerated PIN would leave already-trusted devices walking straight in —
  -- exactly the case where a firm regenerates BECAUSE a device is no longer
  -- trusted.
  add column if not exists portal_pin_salt text,

  -- Lockout state: 5 failed attempts locks this client's portal for 15 minutes.
  --
  -- Deliberately in the DATABASE rather than the existing Upstash rate limiter.
  -- That limiter quietly no-ops when its env vars are absent, which fails OPEN
  -- — fine for spam control, wrong for a security gate. It is also keyed to the
  -- CLIENT and not to a device or IP, so clearing cookies or switching networks
  -- does not hand back a fresh set of attempts.
  add column if not exists portal_pin_failed_attempts integer not null default 0,
  add column if not exists portal_pin_locked_until timestamptz;

-- No index: every read here is by clients.id (the primary key) or arrives
-- already joined from the engagement the magic token resolved to.

comment on column clients.portal_pin_encrypted is
  'AES-256-GCM ciphertext of the 6-digit portal PIN. Encrypted, NOT hashed, because the firm must be able to read it back — see the migration header for the tradeoff.';

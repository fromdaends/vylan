-- Debounced founder-notify pattern for /demo leads.
--
-- Previously each form step fired its own email immediately, which
-- meant the founder got 2 emails per complete lead and an email
-- per partial fill. Now we delay all sends and consolidate:
--
--   * After every step submission, do nothing — just let the row
--     sit.
--   * A cron (/api/cron/demo-leads, every 5 min) finds rows where
--     `notified_at IS NULL` AND `updated_at < now() - 5 minutes`
--     (i.e. 5 minutes of inactivity = "they're done filling out"),
--     sends ONE email reflecting whatever info we have, and sets
--     notified_at so it never fires again.
--
--   * Booking-confirmation emails still fire immediately when
--     cal.com hands us a bookingSuccessful — but markDemoBooked
--     also stamps notified_at, so the cron doesn't double-email a
--     fast-booked lead.

alter table demo_requests
  add column if not exists notified_at timestamptz;

-- Partial index targeted at the cron query. Most rows quickly become
-- "notified" — a partial index on the NULL ones stays tiny.
create index if not exists demo_requests_pending_notify_idx
  on demo_requests (updated_at)
  where notified_at is null;

comment on column demo_requests.notified_at is
  'Set by the /api/cron/demo-leads job (or markDemoBooked) when the founder has been notified about this lead. NULL means still pending.';

-- Landing-page lead form fields.
--
-- The public marketing site (rebuilt from the "vylan #4" Claude Design
-- handoff) has a single-step "Tell us about your firm" form that feeds
-- the SAME demo_requests table the multi-step /demo flow uses — so all
-- leads land in one place and the founder gets one kind of notification.
--
-- That form collects a few fields the 3-step /demo schema doesn't have a
-- clean home for:
--   * practice_type  — "Solo / bookkeeper", "Tax & advisory", etc. This
--                       is a different axis than firm_size (headcount), so
--                       it gets its own text column rather than being
--                       forced into the firm_size enum.
--   * active_clients — the landing form's client-count buckets use
--                       slightly different ranges ("100 – 500", "500+")
--                       than the client_volume enum, so it's stored as the
--                       raw label to avoid mislabeling the founder's email.
--   * notes          — free-text "what's the worst part of document season"
--                       answer.
--   * source         — which entry point created the row ("landing_form"
--                       vs the /demo flow's NULL), so leads can be told
--                       apart later.
--
-- All nullable + additive: the existing /demo flow writes none of these
-- and is completely unaffected.

alter table demo_requests
  add column practice_type  text,
  add column active_clients text,
  add column notes          text,
  add column source         text;

comment on column demo_requests.practice_type is
  'Landing lead form: practice type label (Solo / bookkeeper, Small accounting firm, Mid-size practice, Tax & advisory, Other). NULL for /demo-flow leads.';
comment on column demo_requests.active_clients is
  'Landing lead form: active-client count bucket as a raw label (Under 25, 25 – 100, 100 – 500, 500+). NULL for /demo-flow leads.';
comment on column demo_requests.notes is
  'Landing lead form: free-text answer to "what is the worst part of document season". NULL for /demo-flow leads.';
comment on column demo_requests.source is
  'Entry point that created this lead: "landing_form" for the marketing-site form, NULL for the multi-step /demo flow.';

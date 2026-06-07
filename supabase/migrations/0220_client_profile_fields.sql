-- Client profile fields — province, timezone, industry.
--
-- Three optional, nullable text columns on clients. Accountants set them on the
-- create/edit client form; they default NULL (not specified). No RLS/grant work
-- needed: clients has no authenticated UPDATE column whitelist and the
-- clients_all policy (0002) already lets a firm member insert/update their own
-- firm's rows (same reasoning as 0210's assigned_user_id note).
--
--   * province  — Canadian province/territory code (QC, ON, BC, …).
--   * timezone  — IANA tz the client lives in (America/Toronto, …); a small
--                 Canadian allow-list is enforced in the app, not the DB.
--   * industry  — stable industry slug (real_estate, construction, …); the
--                 label list + localization lives in src/lib/clients/fields.ts.

alter table clients
  add column if not exists province text;
alter table clients
  add column if not exists timezone text;
alter table clients
  add column if not exists industry text;

comment on column clients.province is
  'Canadian province/territory code (QC, ON, …). NULL = not specified.';
comment on column clients.timezone is
  'IANA timezone the client is in (America/Toronto, …). NULL = not specified.';
comment on column clients.industry is
  'Industry slug (real_estate, construction, …) — see src/lib/clients/fields.ts. NULL = not specified.';

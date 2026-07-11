-- Track the Notion page id for each demo lead so subsequent updates
-- (step 3 fired after a partial-lead cron run, booking confirmed
-- after the qualified email, etc.) reuse the same page rather than
-- creating duplicate Notion entries.

alter table demo_requests
  add column if not exists notion_page_id text;

comment on column demo_requests.notion_page_id is
  'Notion page UUID for this lead in the founder''s leads database. Set on first push; reused on subsequent pushes via PATCH /v1/pages/{id}.';

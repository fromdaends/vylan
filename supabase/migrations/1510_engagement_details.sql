-- Engagement details that Canopy's step 1 has and Vylan's did not.
--
-- From the founder's own screenshots of Canopy's Create Engagement, step 1
-- carries: engagement name, START DATE, end date, client, signers, assignees,
-- and a PROPOSAL INTRO MESSAGE. Vylan had the name, a due date, and the client.
--
-- START DATE, separate from due_date. They answer different questions — "when
-- does this work begin" versus "when is it owed" — and conflating them is why
-- an engagement created in advance for next season had no honest way to say it
-- had not started yet. Nullable, because most one-off work genuinely starts the
-- day you make it and forcing a date would be noise.
--
-- INTRO MESSAGE is the covering note at the top of the proposal the client
-- reads. Plain text for now: no rich-text editor exists in this repo yet (every
-- long field is a <Textarea>), and adding one is its own decision that affects
-- the item descriptions and the terms too. Storing text now and upgrading the
-- EDITOR later is safe; storing HTML from an editor that does not exist is not.
--
-- Assignees needed nothing: engagements.assigned_user_id (0001) and
-- engagement_members (1320) already exist. The builder simply never set them,
-- so assignment was always a second step after creation.

alter table if exists public.engagements
  add column if not exists start_date date;

alter table if exists public.engagements
  add column if not exists intro_message text;

comment on column public.engagements.start_date is
  'When the work begins — distinct from due_date, which is when it is owed. Nullable: most one-off work starts the day it is created.';
comment on column public.engagements.intro_message is
  'The covering note at the top of the client''s proposal. PLAIN TEXT — no rich-text editor exists yet, and storing HTML from an editor that does not exist would be a lie about the format.';

-- AUTOMATED WORKFLOWS, chunk 1 — the engine's storage.
--
-- The founder's model, in their words: automations are their own named,
-- reusable things ("premake a bunch of automations... rename... select which
-- one"), a template picks one, and every engagement copies its template's
-- automation the moment it is created — so editing the library never rewrites
-- work already in motion. Same copy-on-use principle as firm_services (1480)
-- and folder templates.
--
-- DIRECTION RULING (founder, 2026-08-04, after the #1301 collision was
-- flagged): the engine runs the six checkpoints and fires entry actions
-- invisibly on the existing stage spine (0690); the engagement-level LABEL is
-- the new agreement status. Nothing here renders a stage; it sequences work.
--
-- Both feature switches ship OFF for every firm. A firm with the flag off (or
-- a database without this migration) behaves byte-identically to today.
--
-- Idempotent throughout. Safe to run twice.

-- ── The automations library ──────────────────────────────────────────────────
-- firm_id NULL = built-in (seeded below, visible to every firm, never editable
-- by any firm — same convention as templates 0005).

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references public.firms(id) on delete cascade,
  name text not null,
  -- The per-stage playbook. jsonb because the definition is still growing
  -- (chunk 3 adds letter config; Part B may annotate) — the READER treats every
  -- field as optional and malformed input as "no workflow" (definition.ts).
  definition jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id) on delete set null
);

create index if not exists automations_firm_idx
  on public.automations (firm_id, created_at desc);

alter table public.automations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'automations' and policyname = 'automations_select'
  ) then
    -- Built-ins (firm_id null) are readable by every signed-in firm member;
    -- a firm's own rows only by that firm.
    create policy automations_select on public.automations
      for select using (
        firm_id is null
        or firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'automations' and policyname = 'automations_insert'
  ) then
    -- firm_id must be the caller's own firm — nobody can create a built-in.
    create policy automations_insert on public.automations
      for insert with check (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'automations' and policyname = 'automations_update'
  ) then
    create policy automations_update on public.automations
      for update using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'automations' and policyname = 'automations_delete'
  ) then
    create policy automations_delete on public.automations
      for delete using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;
end $$;

revoke all on public.automations from anon;
grant select, insert, update, delete on public.automations to authenticated;

comment on table public.automations is
  'Named, reusable workflow playbooks (the founder''s "automations library"). firm_id null = built-in. A template PICKS one and keeps its own copy (copy-on-use); an engagement snapshots its template''s copy at creation. Editing a library row never rewrites templates or in-flight engagements.';

-- ── Templates carry their own copy + provenance ──────────────────────────────

alter table public.templates add column if not exists workflow jsonb;
alter table public.templates
  add column if not exists automation_id uuid references public.automations(id) on delete set null;

comment on column public.templates.workflow is
  'This template''s OWN workflow copy (copy-on-use from an automation, then freely edited). Null = no workflow; engagements created from it fall back to the family default when the firm flag is on.';
comment on column public.templates.automation_id is
  'Provenance only — which library automation this copy came from. Never read through for behaviour.';

-- ── Engagements snapshot the workflow at creation ────────────────────────────

alter table public.engagements add column if not exists workflow jsonb;
alter table public.engagements add column if not exists stage_gates jsonb;

comment on column public.engagements.workflow is
  'Workflow snapshot copied at creation (definition + assignees resolved to user ids). Null = engagement predates workflows / flag off — the legacy stage resolver applies unchanged.';
comment on column public.engagements.stage_gates is
  'Confirm-gate latches, keyed by stage: {"in_review": {"by": "<user id>", "at": "<iso>"}}. A confirm-mode transition only passes once its gate is latched. Sticky by design, like preparation_started_at.';

-- ── Exactly-once ledger for stage-entry effects ──────────────────────────────
-- Same load-bearing idea as recurring_occurrences (0770): the DATABASE dedupes,
-- never the job layer. The 'entered' row is claimed first; each entry action
-- claims its own row. A webhook replay, a concurrent sync, or a re-entered
-- stage (facts regressed and recovered) can never fire a client-facing action
-- twice, because the second insert violates the unique index.

create table if not exists public.workflow_stage_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  stage text not null,
  -- 'entered' | 'assign' | 'materialize_tasks' | one of the entry actions.
  action text not null,
  -- 'done' | 'failed' | 'skipped' — failed/skipped rows keep the claim (at-most
  -- once for client-facing sends; a missed send is visible and recoverable, a
  -- double send to a client is not — the spawn-ledger rule).
  status text not null default 'done'
    check (status in ('done', 'failed', 'skipped')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists workflow_stage_events_once
  on public.workflow_stage_events (engagement_id, stage, action);
create index if not exists workflow_stage_events_engagement_idx
  on public.workflow_stage_events (engagement_id, created_at);

alter table public.workflow_stage_events enable row level security;

do $$
begin
  -- Firm members can READ the ledger (the engagement page's "what fired" rail).
  -- There are deliberately NO insert/update/delete policies: only the service
  -- role (which bypasses RLS) writes here, from the effects runner.
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'workflow_stage_events'
      and policyname = 'workflow_stage_events_select'
  ) then
    create policy workflow_stage_events_select on public.workflow_stage_events
      for select using (
        firm_id in (select firm_id from public.users where id = auth.uid())
      );
  end if;
end $$;

revoke all on public.workflow_stage_events from anon;
grant select on public.workflow_stage_events to authenticated;

comment on table public.workflow_stage_events is
  'Exactly-once ledger for workflow stage entries and their automated actions. UNIQUE(engagement_id, stage, action) is the idempotency guarantee; service-role writes only.';

-- ── Workflow tasks are ordinary engagement_tasks, tagged with their stage ────

alter table public.engagement_tasks add column if not exists workflow_stage text;

comment on column public.engagement_tasks.workflow_stage is
  'Set when this task was materialized by a workflow stage entry (e.g. ''in_preparation''). The stage_tasks_done advance condition counts open tasks with this tag. Null for every hand-made task.';

-- ── Feature switches, OFF by default ─────────────────────────────────────────

alter table public.firms add column if not exists workflows_enabled boolean not null default false;
alter table public.firms add column if not exists ai_suggestions_enabled boolean not null default false;

comment on column public.firms.workflows_enabled is
  'Part A switch: engagement workflows (automations library + stage engine effects). Off = byte-identical to pre-1510 behaviour.';
comment on column public.firms.ai_suggestions_enabled is
  'Part B switch: AI workflow suggestions (propose-and-approve only). Independent of workflows_enabled.';

-- ── Built-in automations (the four family flows from the spec) ───────────────
-- Fixed ids, same convention as builtin templates (0005). Upsert so a re-run
-- refreshes the definitions.

insert into public.automations (id, firm_id, name, definition) values
(
  '00000000-0000-0000-0000-00000000a001',
  null,
  'Tax return flow',
  $wf_return$
  {
    "version": 1,
    "stages": {
      "collecting": {
        "skipped": false, "assignee": "staff",
        "on_entry": ["send_engagement_letter", "activate_checklist"],
        "tasks": [],
        "advance": { "condition": "all_docs_verified", "mode": "automatic" }
      },
      "in_review": {
        "skipped": false, "assignee": "owner",
        "on_entry": ["notify_assignee"],
        "tasks": [
          { "title_en": "Review documents for completeness", "title_fr": "Vérifier que les documents sont complets" }
        ],
        "advance": { "condition": "manual", "mode": "confirm" }
      },
      "in_preparation": {
        "skipped": false, "assignee": "staff",
        "on_entry": [],
        "tasks": [
          { "title_en": "Prepare working papers", "title_fr": "Préparer les papiers de travail" },
          { "title_en": "Prepare the return", "title_fr": "Préparer la déclaration" },
          { "title_en": "Partner review", "title_fr": "Révision par l'associé" }
        ],
        "advance": { "condition": "signature_request_sent", "mode": "automatic" }
      },
      "awaiting_signature": {
        "skipped": false, "assignee": null, "on_entry": [], "tasks": [],
        "advance": { "condition": "signatures_completed", "mode": "automatic" }
      },
      "awaiting_payment": {
        "skipped": false, "assignee": null, "on_entry": ["send_invoice"], "tasks": [],
        "advance": { "condition": "invoice_paid", "mode": "automatic" }
      },
      "completed": {
        "skipped": false, "assignee": null, "on_entry": [], "tasks": [], "advance": null
      }
    }
  }
  $wf_return$::jsonb
),
(
  '00000000-0000-0000-0000-00000000a002',
  null,
  'GST/QST return flow',
  $wf_gst$
  {
    "version": 1,
    "stages": {
      "collecting": {
        "skipped": false, "assignee": "staff",
        "on_entry": ["activate_checklist"], "tasks": [],
        "advance": { "condition": "all_docs_verified", "mode": "automatic" }
      },
      "in_review": {
        "skipped": false, "assignee": "owner", "on_entry": [], "tasks": [],
        "advance": { "condition": "manual", "mode": "confirm" }
      },
      "in_preparation": {
        "skipped": false, "assignee": "staff", "on_entry": [], "tasks": [],
        "advance": { "condition": "manual", "mode": "automatic" }
      },
      "awaiting_signature": {
        "skipped": true, "assignee": null, "on_entry": [], "tasks": [], "advance": null
      },
      "awaiting_payment": {
        "skipped": false, "assignee": null, "on_entry": ["send_invoice"], "tasks": [],
        "advance": { "condition": "invoice_sent", "mode": "automatic" }
      },
      "completed": {
        "skipped": false, "assignee": null, "on_entry": [], "tasks": [], "advance": null
      }
    }
  }
  $wf_gst$::jsonb
),
(
  '00000000-0000-0000-0000-00000000a003',
  null,
  'Monthly bookkeeping flow',
  $wf_book$
  {
    "version": 1,
    "stages": {
      "collecting": {
        "skipped": false, "assignee": "staff",
        "on_entry": ["activate_checklist"], "tasks": [],
        "advance": { "condition": "all_docs_verified", "mode": "automatic" }
      },
      "in_review": {
        "skipped": false, "assignee": "staff", "on_entry": [], "tasks": [],
        "advance": { "condition": "manual", "mode": "confirm" }
      },
      "in_preparation": {
        "skipped": false, "assignee": "staff", "on_entry": [],
        "tasks": [
          { "title_en": "Reconcile bank and credit card accounts", "title_fr": "Concilier les comptes bancaires et cartes de crédit" },
          { "title_en": "Post adjusting entries", "title_fr": "Passer les écritures de régularisation" }
        ],
        "advance": { "condition": "stage_tasks_done", "mode": "automatic" }
      },
      "awaiting_signature": {
        "skipped": true, "assignee": null, "on_entry": [], "tasks": [], "advance": null
      },
      "awaiting_payment": {
        "skipped": false, "assignee": null, "on_entry": ["send_invoice"], "tasks": [],
        "advance": { "condition": "invoice_sent", "mode": "automatic" }
      },
      "completed": {
        "skipped": false, "assignee": null, "on_entry": [], "tasks": [], "advance": null
      }
    }
  }
  $wf_book$::jsonb
),
(
  '00000000-0000-0000-0000-00000000a004',
  null,
  'New client onboarding flow',
  $wf_onboard$
  {
    "version": 1,
    "stages": {
      "collecting": {
        "skipped": false, "assignee": "staff",
        "on_entry": ["send_engagement_letter", "activate_checklist"], "tasks": [],
        "advance": { "condition": "all_docs_verified", "mode": "automatic" }
      },
      "in_review": {
        "skipped": false, "assignee": "owner", "on_entry": [], "tasks": [],
        "advance": { "condition": "manual", "mode": "confirm" }
      },
      "in_preparation": {
        "skipped": true, "assignee": null, "on_entry": [], "tasks": [], "advance": null
      },
      "awaiting_signature": {
        "skipped": true, "assignee": null, "on_entry": [], "tasks": [], "advance": null
      },
      "awaiting_payment": {
        "skipped": true, "assignee": null, "on_entry": [], "tasks": [], "advance": null
      },
      "completed": {
        "skipped": false, "assignee": null, "on_entry": [], "tasks": [], "advance": null
      }
    }
  }
  $wf_onboard$::jsonb
)
on conflict (id) do update set
  name = excluded.name,
  definition = excluded.definition,
  updated_at = now();

-- ── Seed the nine built-in templates with their family flow ──────────────────
-- Copy-on-use even here: each template gets its OWN copy of the definition,
-- with automation_id as provenance. The blank template (…0004) stays bare.

update public.templates t
set workflow = a.definition, automation_id = a.id
from public.automations a
where a.id = '00000000-0000-0000-0000-00000000a001'
  and t.id in (
    '00000000-0000-0000-0000-000000000001', -- T1 Personal
    '00000000-0000-0000-0000-000000000002', -- T2 Corporation
    '00000000-0000-0000-0000-000000000005', -- Self-employed (T2125)
    '00000000-0000-0000-0000-000000000006', -- Rental income (T776)
    '00000000-0000-0000-0000-000000000007', -- Final return (estate)
    '00000000-0000-0000-0000-000000000009'  -- Trust return (T3)
  );

update public.templates t
set workflow = a.definition, automation_id = a.id
from public.automations a
where a.id = '00000000-0000-0000-0000-00000000a002'
  and t.id = '00000000-0000-0000-0000-000000000008'; -- GST/QST return

update public.templates t
set workflow = a.definition, automation_id = a.id
from public.automations a
where a.id = '00000000-0000-0000-0000-00000000a003'
  and t.id = '00000000-0000-0000-0000-000000000003'; -- Monthly bookkeeping

update public.templates t
set workflow = a.definition, automation_id = a.id
from public.automations a
where a.id = '00000000-0000-0000-0000-00000000a004'
  and t.id = '00000000-0000-0000-0000-00000000000a'; -- New client onboarding

-- Verify after applying:
--
--   select count(*) from automations where firm_id is null;       --> 4
--   select count(*) from templates where workflow is not null
--     and firm_id is null;                                        --> 9
--   select workflows_enabled, ai_suggestions_enabled
--     from firms limit 3;                                         --> false, false
--   select count(*) from workflow_stage_events;                   --> 0

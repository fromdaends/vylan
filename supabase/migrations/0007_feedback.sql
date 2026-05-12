-- Phase 9: feedback table for the in-app help sidebar.
-- Anyone signed in can leave feedback; the firm_id scopes ownership for
-- moderation later. We deliberately do NOT add RLS-update/delete policies:
-- feedback is append-only from the firm side.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid references firms(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  message text not null,
  page_url text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_firm_id_idx on feedback(firm_id);
create index if not exists feedback_created_at_idx on feedback(created_at desc);

alter table feedback enable row level security;

-- Firm members can insert feedback for their own firm.
create policy feedback_insert
  on feedback for insert
  to authenticated
  with check (firm_id = public.current_firm_id());

-- Firm members can read their own feedback (in case we ever surface it).
create policy feedback_select
  on feedback for select
  to authenticated
  using (firm_id = public.current_firm_id());

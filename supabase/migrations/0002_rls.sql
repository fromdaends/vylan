-- Relai — row level security.
--
-- Pattern: every domain table is enabled with RLS and scoped to the calling
-- accountant's firm_id via `current_firm_id()`. Client-facing endpoints (no
-- auth) MUST go through the service-role key on the server, after validating
-- a magic token.

alter table firms enable row level security;
alter table users enable row level security;
alter table clients enable row level security;
alter table engagements enable row level security;
alter table request_items enable row level security;
alter table uploaded_files enable row level security;
alter table reminders enable row level security;
alter table templates enable row level security;
alter table activity_log enable row level security;
alter table jobs enable row level security;

-- firms: a user can see/update their own firm only.
create policy firms_select on firms for select
  using (id = public.current_firm_id());
create policy firms_update on firms for update
  using (id = public.current_firm_id())
  with check (id = public.current_firm_id());
-- INSERT into firms is allowed for any authenticated user (sign-up flow).
create policy firms_insert on firms for insert
  to authenticated
  with check (true);

-- users: a user sees rows in their firm; can update themselves.
create policy users_select on users for select
  using (firm_id = public.current_firm_id());
create policy users_insert_self on users for insert
  to authenticated
  with check (id = auth.uid());
create policy users_update_self on users for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- All other domain tables: full CRUD for firm members.
create policy clients_all on clients for all
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

create policy engagements_all on engagements for all
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

create policy request_items_all on request_items for all
  using (
    exists (
      select 1 from engagements e
      where e.id = request_items.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (
      select 1 from engagements e
      where e.id = request_items.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  );

create policy uploaded_files_all on uploaded_files for all
  using (
    exists (
      select 1 from engagements e
      where e.id = uploaded_files.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (
      select 1 from engagements e
      where e.id = uploaded_files.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  );

create policy reminders_all on reminders for all
  using (
    exists (
      select 1 from engagements e
      where e.id = reminders.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  )
  with check (
    exists (
      select 1 from engagements e
      where e.id = reminders.engagement_id
        and e.firm_id = public.current_firm_id()
    )
  );

create policy templates_select on templates for select
  using (firm_id is null or firm_id = public.current_firm_id());
create policy templates_write on templates for all
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

create policy activity_log_select on activity_log for select
  using (firm_id = public.current_firm_id());
create policy activity_log_insert on activity_log for insert
  with check (firm_id = public.current_firm_id());

-- jobs: never exposed to firm users directly; only service role touches it.
-- We keep RLS enabled with no policy = deny all to authenticated.

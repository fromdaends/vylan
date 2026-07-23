-- 0810_client_private.sql
--
-- Team Wave 4 — "Private to me" owner privacy.
--
-- An OWNER can mark a specific client PRIVATE. A private client, and everything
-- that hangs off it (its engagements, uploaded files, request items, reminders,
-- final documents, file comments, client messages, payment/signature requests,
-- recurring series, bookkeeping drafts, and engagement-scoped activity), becomes
-- INVISIBLE TO STAFF but stays fully VISIBLE TO ALL OWNERS ("co-owners"). Firm
-- (tenant) isolation is UNCHANGED: every predicate below keeps
-- `firm_id = current_firm_id()` ANDed, and the owner bypass only ever RELAXES
-- the private term — never the firm term — so an owner of firm A still only ever
-- sees firm-A rows. There is no cross-firm vector here.
--
-- Design notes:
--  * The flag lives ONLY on clients. The cascade to children is DERIVED in RLS
--    (via the two security-definer helpers below), never denormalized onto
--    engagements/files, so it can never drift.
--  * uploaded_files / request_items / reminders need NO change: their existing
--    policies already gate through an EXISTS join to the parent engagement, so
--    once the engagements policy hides a private client's engagements the child
--    rows disappear automatically.
--  * The definer helpers exist to avoid the "RLS-in-subquery trap": a bare
--    `exists (select 1 from clients where ... is_private)` inside a staff policy
--    would run UNDER RLS, the private client would be invisible, the EXISTS would
--    be false the wrong way, and the row would LEAK. Reading is_private through a
--    security-definer function (which bypasses RLS) gives the true answer. The
--    helpers return only a boolean for an already-firm-scoped id, so they expose
--    nothing across firms.
--  * The column add AND every policy rewrite are in THIS ONE migration — a policy
--    cannot reference a column that does not exist yet. Before this migration is
--    applied the OLD firm-only policies remain in force and there is no
--    is_private column, so nothing is hidden (today's behavior) — never a leak,
--    never a 500. App code must not assume RLS is already hiding rows before
--    this lands (it reads clients with select('*') and coalesces is_private to
--    false, and guards the write with PGRST204).
--
-- Deliberately NOT covered (accepted residual, low risk):
--  * storage.objects raw bytes (0003): the bucket policy is left as-is; the
--    in-app file byte routes (/api/files/[id], /thumb, /files.zip) instead
--    authorize the parent engagement through the AUTHED (RLS) client so a private
--    client's file 404s for staff. Portal + service-role byte proxies are
--    unaffected by design.

-- 1) The flag ----------------------------------------------------------------

alter table public.clients
  add column if not exists is_private boolean not null default false;

comment on column public.clients.is_private is
  '"Private to me": owner-set flag. When true the client and (via cascade in RLS) its engagements + files + messages + comments + drafts + engagement activity are hidden from STAFF but visible to ALL owners. Firm scoping is unchanged. Owner-only-settable, enforced by the clients_all WITH CHECK arm + the setClientPrivacyAction owner gate.';

-- Partial index: only the (rare) private rows are indexed, so the helper lookups
-- below stay cheap without bloating the common all-visible case.
create index if not exists clients_firm_private_idx
  on public.clients (firm_id)
  where is_private = true;

-- 2) Owner-bypass cascade helpers (security definer = bypass RLS) --------------

-- Both helpers self-scope to the CALLER's firm (`firm_id = current_firm_id()`)
-- inside the body. This is BELT-AND-SUSPENDERS, and it matters:
--  * Inside the policies below the id passed is always a row that's already
--    firm-scoped, so the firm check is a no-op there — it never changes a
--    legitimate answer.
--  * These functions inherit Postgres's default EXECUTE-to-PUBLIC grant (the
--    same as current_firm_id/current_user_is_owner — we deliberately DON'T
--    revoke it, because a function used inside an RLS policy MUST be executable
--    by the querying role or every authenticated read of clients/engagements
--    would fail). Self-scoping is what makes leaving them PUBLIC safe: a firm-B
--    caller invoking them directly via PostgREST RPC with a firm-A id gets a
--    plain `false` (no row matches their firm), so there is no cross-firm
--    "is this a real private client?" oracle. current_firm_id() reads the
--    caller's JWT (auth.uid()), which is unaffected by the definer context.
--  * A null id (payment_requests / quickbooks_connections nullable client_id)
--    matches no row → false → "not private" → visible, as intended.
create or replace function public.client_is_private(cid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select is_private from public.clients
    where id = cid and firm_id = public.current_firm_id()
  ), false)
$$;

create or replace function public.engagement_is_private(eid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.is_private
    from public.engagements e
    join public.clients c on c.id = e.client_id
    where e.id = eid and e.firm_id = public.current_firm_id()
  ), false)
$$;

-- Two more definer helpers for children that reach the client through an
-- ALSO-RLS-GATED table (chat_messages → chat_conversations; recurring_occurrences
-- → recurring_series). A bare `(select ... from that_table)` subquery inside the
-- policy would run UNDER that table's (now private-gated) RLS, come back empty
-- for staff, and read as "not private" — re-opening the very leak we're closing.
-- Reading through a security-definer helper (RLS-bypassing, firm-self-scoped)
-- gives the true answer.
create or replace function public.conversation_is_private(convid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.is_private
    from public.chat_conversations cc
    join public.engagements e on e.id = cc.engagement_id
    join public.clients c on c.id = e.client_id
    where cc.id = convid and cc.firm_id = public.current_firm_id()
  ), false)
$$;

create or replace function public.series_is_private(sid uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.is_private
    from public.recurring_series s
    join public.clients c on c.id = s.client_id
    where s.id = sid and s.firm_id = public.current_firm_id()
  ), false)
$$;

comment on function public.client_is_private(uuid) is
  'True if the given client is marked "Private to me". Security-definer so it reads the real flag regardless of the caller''s RLS visibility (avoids the RLS-in-subquery leak). Returns only a boolean; no cross-firm data leaves it.';
comment on function public.engagement_is_private(uuid) is
  'True if the given engagement''s client is marked "Private to me". Security-definer (see client_is_private).';
comment on function public.conversation_is_private(uuid) is
  'True if the given AI-chat conversation''s client is marked "Private to me". Security-definer (see client_is_private) — used because chat_messages reaches the engagement only through the RLS-gated chat_conversations.';
comment on function public.series_is_private(uuid) is
  'True if the given recurring series'' client is marked "Private to me". Security-definer (see client_is_private) — used because recurring_occurrences reaches the client only through the RLS-gated recurring_series.';

-- 3) Source of truth: clients ------------------------------------------------
-- Private term on BOTH arms. The WITH CHECK arm is load-bearing: it is what makes
-- the flag OWNER-ONLY-SETTABLE at the DB layer — a staff UPDATE/INSERT that would
-- leave the row private while the actor is not an owner fails the check; and staff
-- can't clear a private client's flag because USING already hides it from them.

drop policy if exists clients_all on public.clients;
create policy clients_all on public.clients for all
  using (
    firm_id = public.current_firm_id()
    and (coalesce(is_private, false) = false or public.current_user_is_owner())
  )
  with check (
    firm_id = public.current_firm_id()
    and (coalesce(is_private, false) = false or public.current_user_is_owner())
  );

-- 4) Engagements: cascade via client_id (NOT NULL) ---------------------------

drop policy if exists engagements_all on public.engagements;
create policy engagements_all on public.engagements for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  )
  with check (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

-- 5) Engagement/client child tables whose SELECT is firm_id-only -------------
-- These do NOT gate through the parent engagement, so they would leak a private
-- client's rows to staff unless extended. We touch ONLY the read (USING) arm and
-- leave every INSERT/WITH-CHECK containment arm exactly as-is.

-- final_documents (0620): FOR ALL, keyed by engagement_id. Read arm only.
drop policy if exists final_documents_all on public.final_documents;
create policy final_documents_all on public.final_documents for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  )
  with check (firm_id = public.current_firm_id());

-- payment_requests (0380): FOR ALL, engagement_id (nullable) + client_id (nullable).
-- Hidden for staff if EITHER the engagement or the directly-linked client is private.
drop policy if exists payment_requests_all on public.payment_requests;
create policy payment_requests_all on public.payment_requests for all
  using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or (
        (engagement_id is null or not public.engagement_is_private(engagement_id))
        and (client_id is null or not public.client_is_private(client_id))
      )
    )
  )
  with check (firm_id = public.current_firm_id());

-- signature_requests (0400): FOR ALL, keyed by engagement_id. Read arm only.
drop policy if exists signature_requests_all on public.signature_requests;
create policy signature_requests_all on public.signature_requests for all
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  )
  with check (firm_id = public.current_firm_id());

-- file_comments (0800): SELECT policy, keyed by engagement_id.
drop policy if exists file_comments_select on public.file_comments;
create policy file_comments_select on public.file_comments
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  );

-- client_message_threads (0650): SELECT policy, keyed by engagement_id.
drop policy if exists client_message_threads_select on public.client_message_threads;
create policy client_message_threads_select on public.client_message_threads
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  );

-- client_messages (0650): SELECT policy, keyed by engagement_id (the table has
-- its own engagement_id column — no thread join needed).
drop policy if exists client_messages_select on public.client_messages;
create policy client_messages_select on public.client_messages
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  );

-- recurring_series (0770): SELECT policy, keyed by client_id.
drop policy if exists recurring_series_select on public.recurring_series;
create policy recurring_series_select on public.recurring_series
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

-- quickbooks_transaction_suggestions (0430; also holds Xero drafts via the
-- provider column from 0790): the bookkeeping-queue rows. SELECT policy, keyed by
-- engagement_id (NOT NULL).
drop policy if exists qbo_tx_suggestions_select on public.quickbooks_transaction_suggestions;
create policy qbo_tx_suggestions_select on public.quickbooks_transaction_suggestions
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  );

-- activity_log (0002): SELECT policy, engagement_id (nullable). Engagement-scoped
-- rows for a private client are hidden from staff. Firm/client-level rows
-- (engagement_id null) stay visible, but a private client's name won't resolve
-- for staff anyway (getClient is RLS-hidden), so the row reads as bare metadata.
drop policy if exists activity_log_select on public.activity_log;
create policy activity_log_select on public.activity_log
  for select using (
    firm_id = public.current_firm_id()
    and (
      public.current_user_is_owner()
      or engagement_id is null
      or not public.engagement_is_private(engagement_id)
    )
  );

-- chat_conversations (0550): the engagement AI-assistant thread. SELECT policy,
-- keyed by engagement_id (NOT NULL). content/transcript is real client data.
drop policy if exists chat_conversations_select on public.chat_conversations;
create policy chat_conversations_select on public.chat_conversations
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  );

-- chat_messages (0550): individual assistant/user turns. No engagement_id of its
-- own — resolve the engagement through its conversation.
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.conversation_is_private(conversation_id))
  );

-- chat_pending_actions (0560): staged AI actions; payload carries file names /
-- item labels / current values. SELECT policy, keyed by engagement_id (NOT NULL).
drop policy if exists chat_pending_actions_select on public.chat_pending_actions;
create policy chat_pending_actions_select on public.chat_pending_actions
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.engagement_is_private(engagement_id))
  );

-- recurring_occurrences (0770): the per-period ledger of a recurring series. 0810
-- already gated recurring_series; the occurrences point at it and leak the
-- private client's billing cadence/existence otherwise. Gate via series_id (NOT
-- NULL) → the series' client (engagement_id is nullable pre-spawn, so don't use it).
drop policy if exists recurring_occurrences_select on public.recurring_occurrences;
create policy recurring_occurrences_select on public.recurring_occurrences
  for select using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.series_is_private(series_id))
  );

-- xero_connections (0740) / quickbooks_connections (0410 + per-client 0710): the
-- bookkeeping CONNECTION rows (NOT the chart-of-accounts cache, which stays an
-- accepted residual above). These carry the client's connected org NAME
-- (tenant_name / company_name) and are listable firm-wide, so they'd reveal a
-- private client's existence + org name to staff. Gate via client_id. Xero's
-- client_id is NOT NULL; QBO's is nullable (null = legacy firm-level) and
-- client_is_private(null) = false, so those legacy rows stay visible.
drop policy if exists xero_connections_select on public.xero_connections;
create policy xero_connections_select on public.xero_connections for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

drop policy if exists quickbooks_connections_select on public.quickbooks_connections;
create policy quickbooks_connections_select on public.quickbooks_connections for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

-- 6) Per-client bookkeeping REFERENCE CACHE (QBO 0410/0710 + Xero 0780) --------
-- Chart of accounts, vendors, customers, items, tax codes/rates, learned
-- mappings — all firm-only SELECT with a direct client_id (QBO's is nullable =
-- legacy firm-level → client_is_private(null)=false → stays visible; Xero's is
-- NOT NULL). These carry the private client's third-party bookkeeping data, so
-- gate them via client_id too. Read arm only; writes stay service-role. (This
-- data is only surfaced while editing a draft — which is already hidden for a
-- private client — but a direct PostgREST read would otherwise still return it,
-- so we close it for a complete guarantee rather than leave it residual.)

drop policy if exists quickbooks_accounts_select on public.quickbooks_accounts;
create policy quickbooks_accounts_select on public.quickbooks_accounts for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

drop policy if exists quickbooks_vendors_select on public.quickbooks_vendors;
create policy quickbooks_vendors_select on public.quickbooks_vendors for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

drop policy if exists quickbooks_customers_select on public.quickbooks_customers;
create policy quickbooks_customers_select on public.quickbooks_customers for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

drop policy if exists quickbooks_tax_codes_select on public.quickbooks_tax_codes;
create policy quickbooks_tax_codes_select on public.quickbooks_tax_codes for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

drop policy if exists quickbooks_items_select on public.quickbooks_items;
create policy quickbooks_items_select on public.quickbooks_items for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

drop policy if exists qbo_learned_select on public.quickbooks_learned_mappings;
create policy qbo_learned_select on public.quickbooks_learned_mappings for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

drop policy if exists xero_accounts_select on public.xero_accounts;
create policy xero_accounts_select on public.xero_accounts for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

drop policy if exists xero_contacts_select on public.xero_contacts;
create policy xero_contacts_select on public.xero_contacts for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

drop policy if exists xero_tax_rates_select on public.xero_tax_rates;
create policy xero_tax_rates_select on public.xero_tax_rates for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

drop policy if exists xero_items_select on public.xero_items;
create policy xero_items_select on public.xero_items for select
  using (
    firm_id = public.current_firm_id()
    and (public.current_user_is_owner() or not public.client_is_private(client_id))
  );

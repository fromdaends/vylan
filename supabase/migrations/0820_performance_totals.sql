-- 0820_performance_totals.sql
--
-- Team Wave 4 Part 2 — "count but don't name" for the Performance page.
--
-- After 0810, a staff member's RLS-scoped reads exclude "Private to me" clients,
-- so the firm-wide Performance TOTALS they see would UNDERCOUNT (revenue,
-- documents received, automation events all drop the private clients' rows).
-- The founder's decision: staff keep the Performance page and should see HONEST
-- firm totals that INCLUDE private clients, but must never see WHICH clients are
-- private (no names).
--
-- These SECURITY DEFINER functions are the "totals" source. Each:
--   * self-scopes to the CALLER's firm (firm_id = current_firm_id() inside), so a
--     firm-B caller can never read firm-A data — tenant isolation is preserved;
--   * bypasses RLS (definer) so PRIVATE clients ARE included in the aggregate;
--   * for the row-returning ones, REDACTS the private client's id to NULL when the
--     caller is NOT an owner — so the amount still counts toward the totals but a
--     staff member (even calling the RPC directly via PostgREST) can neither name
--     nor enumerate which clients are private. Owners get the real id (they see
--     everything). The app then resolves names via the ordinary RLS-scoped clients
--     read, which already hides private names from staff — so private clients fall
--     out of the "top clients" ranking for staff and stay named for owners, with
--     zero extra logic.
--   * carries NO client name/title in its output at all — only amounts, dates,
--     and (redacted) ids — so there is no identity leak even before the ranking.
--
-- EXECUTE is granted to `authenticated` (the app calls these as the signed-in
-- user via .rpc()) and revoked from anon/public. These are NOT referenced inside
-- any RLS policy, so restricting EXECUTE is safe (unlike the 0810 cascade
-- helpers, which must stay PUBLIC because policies evaluate them per row).
--
-- Graceful degradation: until this migration is applied, the loaders fall back to
-- their existing RLS-scoped reads (which merely undercount for staff — never a
-- 500), so this is safe to deploy ahead of being applied.

-- Money: paid invoices in range (drives collected total, buckets, time-to-paid,
-- and the ranking). client_id redacted to null for staff on private clients.
create or replace function public.perf_paid_invoices(p_start timestamptz)
  returns table (
    amount_cents bigint,
    currency text,
    created_at timestamptz,
    paid_at timestamptz,
    client_id uuid,
    locks_deliverables boolean
  )
  language sql stable security definer set search_path = public as $$
  select
    pr.amount_cents,
    pr.currency,
    pr.created_at,
    pr.paid_at,
    case
      when public.current_user_is_owner() or not coalesce(c.is_private, false)
      then pr.client_id
      else null
    end as client_id,
    pr.locks_deliverables
  from public.payment_requests pr
  left join public.clients c on c.id = pr.client_id
  where pr.firm_id = public.current_firm_id()
    and pr.status = 'paid'
    and pr.paid_at is not null
    and (p_start is null or pr.paid_at >= p_start)
  order by pr.paid_at desc
  limit 50000
$$;

-- Money: currently-unpaid invoices (drives the outstanding total). No client
-- identity is needed or returned — the outstanding view is amounts only.
create or replace function public.perf_outstanding_invoices()
  returns table (amount_cents bigint, currency text)
  language sql stable security definer set search_path = public as $$
  select pr.amount_cents, pr.currency
  from public.payment_requests pr
  where pr.firm_id = public.current_firm_id()
    and pr.status = 'requested'
  order by pr.created_at desc
  limit 50000
$$;

-- Documents received in range (drives the received total, buckets, turnaround,
-- and the ranking). Resolves the client through the engagement and redacts it to
-- null for staff on private clients. Duplicates are returned and filtered in the
-- app (parity with the RLS path); is_duplicate is not client-identifying.
create or replace function public.perf_received_docs(p_start timestamptz)
  returns table (
    uploaded_at timestamptz,
    reviewed_at timestamptz,
    client_id uuid,
    is_duplicate boolean
  )
  language sql stable security definer set search_path = public as $$
  select
    f.uploaded_at,
    f.reviewed_at,
    case
      when public.current_user_is_owner() or not coalesce(c.is_private, false)
      then e.client_id
      else null
    end as client_id,
    f.is_duplicate
  from public.uploaded_files f
  join public.engagements e on e.id = f.engagement_id
  left join public.clients c on c.id = e.client_id
  where e.firm_id = public.current_firm_id()
    and (p_start is null or f.uploaded_at >= p_start)
  order by f.uploaded_at desc
  limit 100000
$$;

-- Documents still awaiting a decision (drives the "pending review" tile). A
-- scalar firm-wide count — no identity travels.
create or replace function public.perf_pending_docs_count()
  returns integer
  language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.uploaded_files f
  join public.engagements e on e.id = f.engagement_id
  where e.firm_id = public.current_firm_id()
    and f.review_status = 'pending'
    and f.is_duplicate is not true
$$;

-- Automation: firm-wide count of an activity_log action in range (reminders sent,
-- retry emails/texts). Scalar count only.
create or replace function public.perf_action_count(p_action text, p_start timestamptz)
  returns integer
  language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.activity_log a
  where a.firm_id = public.current_firm_id()
    and a.action = p_action
    and (p_start is null or a.created_at >= p_start)
$$;

comment on function public.perf_paid_invoices(timestamptz) is
  'Performance "count but don''t name": firm-scoped paid invoices incl. private clients (client_id redacted to null for non-owners). See 0820 header.';

revoke all on function public.perf_paid_invoices(timestamptz) from public, anon;
revoke all on function public.perf_outstanding_invoices() from public, anon;
revoke all on function public.perf_received_docs(timestamptz) from public, anon;
revoke all on function public.perf_pending_docs_count() from public, anon;
revoke all on function public.perf_action_count(text, timestamptz) from public, anon;

grant execute on function public.perf_paid_invoices(timestamptz) to authenticated;
grant execute on function public.perf_outstanding_invoices() to authenticated;
grant execute on function public.perf_received_docs(timestamptz) to authenticated;
grant execute on function public.perf_pending_docs_count() to authenticated;
grant execute on function public.perf_action_count(text, timestamptz) to authenticated;

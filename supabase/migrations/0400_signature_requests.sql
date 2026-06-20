-- SignWell e-signatures Phase 2: signature requests.
--
-- A signature_request tracks ONE embedded SignWell signing of a signature
-- checklist item (the accountant's "Request a signature"). It holds the SignWell
-- document id + status, the test/live mode it was created under, the signer, and
-- (later phases) the returned signed PDF + audit trail. Firm-scoped via RLS; the
-- client portal and the SignWell webhook read/write through the SERVICE ROLE
-- (which bypasses RLS), so no anon policy is needed — same shape as
-- payment_requests (migration 0380).
--
-- One signature_request per signature item (unique request_item_id): a fresh
-- "Request a signature" creates a fresh item, hence a fresh row. A retry of the
-- same item updates the row in place.
--
-- Additive + reversible (down: drop table signature_requests).

create table if not exists signature_requests (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references firms(id) on delete cascade,
  engagement_id uuid not null references engagements(id) on delete cascade,
  request_item_id uuid not null references request_items(id) on delete cascade,
  -- SignWell identifiers + state. document_id is null until the API call
  -- succeeds (e.g. before the API key is set). status mirrors SignWell's
  -- lifecycle, normalized to our lowercase set (see mapSignwellStatus).
  signwell_document_id text,
  status text not null default 'pending'
    check (status in (
      'pending', 'sent', 'viewed', 'completed',
      'declined', 'canceled', 'expired', 'error'
    )),
  -- Built in test mode? Recorded per request (watermarked + not legally binding)
  -- so the mode is known even after the global test/live switch flips.
  test_mode boolean not null default true,
  -- The single signer (the client) as sent to SignWell.
  signer_email text,
  signer_name text,
  -- The returned signed PDF (Phase 4): stored in the private client-uploads
  -- bucket, same firm-scoped prefix as other engagement files.
  signed_file_path text,
  completed_at timestamptz,
  -- Webhook idempotency (Phase 4): the last SignWell event we processed, so a
  -- re-delivered event is a no-op.
  last_event_type text,
  last_event_time timestamptz,
  -- Non-fatal create/setup error surfaced to the accountant (e.g. missing key).
  error_detail text,
  created_at timestamptz not null default now()
);

create unique index if not exists signature_requests_item_idx
  on signature_requests (request_item_id);
create index if not exists signature_requests_firm_created_idx
  on signature_requests (firm_id, created_at desc);
create index if not exists signature_requests_engagement_idx
  on signature_requests (engagement_id);
-- The webhook looks rows up by SignWell document id; unique (where present) so a
-- document maps to exactly one request.
create unique index if not exists signature_requests_document_idx
  on signature_requests (signwell_document_id)
  where signwell_document_id is not null;

alter table signature_requests enable row level security;

-- Firm members read/write their own firm's signature requests. The portal +
-- webhook use the service role, which bypasses RLS, so no anon policy is needed.
drop policy if exists signature_requests_all on signature_requests;
create policy signature_requests_all on signature_requests for all
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

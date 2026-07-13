// Data layer for payment requests (Phase 3).
//
// Accountant-side reads/writes go through the RLS-scoped session client (firm
// members see only their own firm's rows). The client portal and the Stripe
// webhook use the service role elsewhere. Everything degrades gracefully before
// migration 0380 is applied to the remote DB (dev uses remote Supabase): a
// missing table/column is treated as "no payment requests yet" so the UI never
// hard-errors.

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";

export type PaymentRequestStatus = "requested" | "paid" | "failed" | "canceled";
export type PaymentDelivery = "portal" | "email" | "both";

export type PaymentRequest = {
  id: string;
  firm_id: string;
  engagement_id: string | null;
  client_id: string | null;
  amount_cents: number;
  currency: string;
  description: string | null;
  status: PaymentRequestStatus;
  delivery: PaymentDelivery;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  requested_by_user_id: string | null;
  // True for automated invoices (migration 0590). Optional on the type so reads
  // survive the pre-migration window; defaults false for manual requests.
  auto?: boolean;
  // Deliverables lock (migration 0610). When locks_deliverables is true and the
  // invoice is unpaid (and not overridden), the engagement's Final documents are
  // gated in the client portal. Optional so reads survive the pre-0610 window.
  locks_deliverables?: boolean;
  override_unlocked?: boolean;
  created_at: string;
};

// A write that referenced a column the current DB doesn't have yet (migration in
// code but not applied here). PostgREST reports PGRST204; Postgres 42703. Used to
// retry the insert WITHOUT the newest columns so payments keep working in the
// deploy->migrate window (dev uses remote Supabase).
function isUnknownColumnError(
  err: { code?: string } | null,
): boolean {
  return err?.code === "PGRST204" || err?.code === "42703";
}

// PostgREST: PGRST205 = table not in schema cache (migration not applied),
// PGRST204 = column missing; 42P01 / 42703 are the Postgres equivalents.
function isMissingSchema(
  err: { code?: string; message?: string } | null,
): boolean {
  if (!err) return false;
  return (
    err.code === "PGRST205" ||
    err.code === "PGRST204" ||
    err.code === "42P01" ||
    err.code === "42703" ||
    /payment_requests/i.test(err.message ?? "")
  );
}

export type CreatePaymentRequestInput = {
  firm_id: string;
  engagement_id: string | null;
  client_id: string | null;
  amount_cents: number;
  currency: string;
  description: string | null;
  delivery: PaymentDelivery;
  requested_by_user_id: string | null;
  // Deliverables lock (migration 0610). Optional so callers that don't gate
  // Final documents omit it; the insert drops it gracefully pre-0610.
  locks_deliverables?: boolean;
};

// Returns the created row, the string "duplicate" when the one-invoice-per-
// engagement unique index (payment_requests_engagement_active_uniq, 0610)
// rejected a concurrent create (the caller treats this as "already invoiced",
// NOT a save failure), or null on a missing table (pre-0380) / other failure.
export async function createPaymentRequest(
  input: CreatePaymentRequestInput,
): Promise<PaymentRequest | "duplicate" | null> {
  const sb = await getServerSupabase();
  const { locks_deliverables, ...base } = input;
  const withLock =
    locks_deliverables != null ? { ...base, locks_deliverables } : base;
  let { data, error } = await sb
    .from("payment_requests")
    .insert(withLock)
    .select("*")
    .single();
  // Pre-0610: retry WITHOUT the lock column so the invoice still records (the
  // lock is simply inert until the migration lands).
  if (error && isUnknownColumnError(error) && locks_deliverables != null) {
    ({ data, error } = await sb
      .from("payment_requests")
      .insert(base)
      .select("*")
      .single());
  }
  if (error) {
    // 23505 = unique_violation: a concurrent create won the one-invoice race.
    // Benign — exactly one live invoice exists, which is the whole point.
    if (error.code === "23505") return "duplicate";
    if (isMissingSchema(error)) {
      console.warn(
        "[payment-requests] createPaymentRequest: table missing (migration 0380 not applied yet)",
      );
      return null;
    }
    console.error("[payment-requests] createPaymentRequest failed:", error);
    return null;
  }
  return data as PaymentRequest;
}

export async function listPaymentRequestsForEngagement(
  engagementId: string,
): Promise<PaymentRequest[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("payment_requests")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false });
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[payment-requests] list failed:", error);
    }
    return [];
  }
  return (data as PaymentRequest[]) ?? [];
}

// The most recent payment request for an engagement — drives the status badge
// and whether the "Request payment" dialog opens in "another request" mode.
export async function getLatestPaymentRequestForEngagement(
  engagementId: string,
): Promise<PaymentRequest | null> {
  const rows = await listPaymentRequestsForEngagement(engagementId);
  return rows[0] ?? null;
}

// Accountant's manual "unlock without payment" (migration 0610): mark the invoice
// as overriding the deliverables lock, so the client can download the finished
// work even though the invoice is still unpaid. RLS-scoped (firm members only).
// Returns true only when a row was ACTUALLY updated — never on a paid-in-a-race
// no-op (the .neq guard matches zero rows) — so the caller doesn't log a false
// "unlocked" event for an invoice that just got paid.
export async function setPaymentRequestOverrideUnlocked(
  id: string,
): Promise<boolean> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("payment_requests")
    .update({ override_unlocked: true })
    .eq("id", id)
    .neq("status", "paid")
    .neq("status", "canceled")
    .select("id");
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[payment-requests] setOverrideUnlocked failed:", error);
    }
    return false;
  }
  return (data?.length ?? 0) > 0;
}

// Accountant "waive invoice": cancel the invoice (nothing owed). A cancelled
// invoice also unlocks the deliverables (the lock only applies while owed). Never
// overwrites a paid row (the .neq guard); returns true only when a row was
// actually cancelled, so a paid-in-a-race waive doesn't log a false event.
export async function cancelPaymentRequest(id: string): Promise<boolean> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("payment_requests")
    .update({ status: "canceled" })
    .eq("id", id)
    .neq("status", "paid")
    .select("id");
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[payment-requests] cancelPaymentRequest failed:", error);
    }
    return false;
  }
  return (data?.length ?? 0) > 0;
}

// The amount (in cents) of the firm's most recent payment request — used to
// pre-fill the dialog ("remember last amount") when there's no per-service
// default. Returns null if the firm has never requested a payment.
export async function getLastFirmPaymentAmountCents(
  firmId: string,
): Promise<number | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("payment_requests")
    .select("amount_cents")
    .eq("firm_id", firmId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[payment-requests] getLastFirmPaymentAmount failed:", error);
    }
    return null;
  }
  return (data?.amount_cents as number | undefined) ?? null;
}

// Latest payment status for a SET of engagements in ONE query (no N+1) — feeds
// the per-engagement badge on the dashboard worklist + engagements list. Rows
// are ordered newest-first, so the first row seen per engagement is the latest.
export async function getLatestPaymentStatusByEngagementIds(
  ids: string[],
): Promise<
  Map<string, { status: PaymentRequestStatus; amount_cents: number; currency: string }>
> {
  const out = new Map<
    string,
    { status: PaymentRequestStatus; amount_cents: number; currency: string }
  >();
  if (ids.length === 0) return out;
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("payment_requests")
    .select("engagement_id, status, amount_cents, currency, created_at")
    .in("engagement_id", ids)
    .order("created_at", { ascending: false });
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[payment-requests] getLatestStatusByIds failed:", error);
    }
    return out;
  }
  for (const row of data ?? []) {
    const eid = row.engagement_id as string | null;
    if (!eid || out.has(eid)) continue;
    out.set(eid, {
      status: row.status as PaymentRequestStatus,
      amount_cents: row.amount_cents as number,
      currency: (row.currency as string) ?? "cad",
    });
  }
  return out;
}

export type PaymentsListRow = {
  id: string;
  status: PaymentRequestStatus;
  amountCents: number;
  currency: string;
  createdAt: string;
  clientName: string | null;
  engagementTitle: string | null;
};

// Recent payments (RLS-scoped to the firm) for the Payments settings list and
// the per-client payments history. Pass clientId to scope to one client. Joins
// client + engagement names in JS (this repo has no PostgREST embeds). Degrades
// to [] before migration 0380 is applied.
export async function listFirmPaymentsWithNames(
  opts: { clientId?: string; limit?: number } = {},
): Promise<PaymentsListRow[]> {
  const { clientId, limit = 50 } = opts;
  const sb = await getServerSupabase();
  let query = sb
    .from("payment_requests")
    .select(
      "id, engagement_id, client_id, amount_cents, currency, status, created_at",
    );
  if (clientId) query = query.eq("client_id", clientId);
  const { data: prs, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[payment-requests] listFirmPaymentsWithNames failed:", error);
    }
    return [];
  }
  const rows = prs ?? [];
  const engIds = [
    ...new Set(rows.map((r) => r.engagement_id).filter(Boolean)),
  ] as string[];
  const cliIds = [
    ...new Set(rows.map((r) => r.client_id).filter(Boolean)),
  ] as string[];
  const engTitle = new Map<string, string>();
  const cliName = new Map<string, string>();
  if (engIds.length) {
    const { data } = await sb
      .from("engagements")
      .select("id, title")
      .in("id", engIds);
    for (const e of data ?? []) engTitle.set(e.id as string, e.title as string);
  }
  if (cliIds.length) {
    const { data } = await sb
      .from("clients")
      .select("id, display_name")
      .in("id", cliIds);
    for (const c of data ?? [])
      cliName.set(c.id as string, c.display_name as string);
  }
  return rows.map((r) => ({
    id: r.id as string,
    status: r.status as PaymentRequestStatus,
    amountCents: r.amount_cents as number,
    currency: (r.currency as string) ?? "cad",
    createdAt: r.created_at as string,
    clientName: r.client_id ? (cliName.get(r.client_id) ?? null) : null,
    engagementTitle: r.engagement_id
      ? (engTitle.get(r.engagement_id) ?? null)
      : null,
  }));
}

// ── Service-role helpers ────────────────────────────────────────────────────
// Used by the unauthenticated client portal (checkout route) and the Stripe
// webhook, neither of which has a user session. The service role bypasses RLS,
// so callers MUST derive ids/amounts from trusted server state (the magic token
// / the Stripe event), never from client input.

// Service-role create, for automated invoicing (the completion hook + the
// scheduled-invoice cron worker, neither of which necessarily has a user
// session). The caller MUST derive every field from trusted server state (the
// engagement row), never from client input. Marks the row auto=true so the
// partial unique index (payment_requests_auto_active_uniq, migration 0590) can
// atomically reject a concurrent second auto-send.
//
// Returns the row on success, the string "duplicate" when the unique index
// rejected a concurrent auto-send (the caller treats this as "already sent",
// NOT an error), or null on a missing table (pre-0380) / any other failure.
export async function createPaymentRequestSR(
  input: CreatePaymentRequestInput,
): Promise<PaymentRequest | "duplicate" | null> {
  const sb = getServiceRoleSupabase();
  const { locks_deliverables, ...base } = input;
  const withLock =
    locks_deliverables != null
      ? { ...base, auto: true, locks_deliverables }
      : { ...base, auto: true };
  let { data, error } = await sb
    .from("payment_requests")
    .insert(withLock)
    .select("*")
    .single();
  // Pre-0610: retry WITHOUT the lock column (the lock is inert until 0610 lands).
  if (error && isUnknownColumnError(error) && locks_deliverables != null) {
    ({ data, error } = await sb
      .from("payment_requests")
      .insert({ ...base, auto: true })
      .select("*")
      .single());
  }
  if (error) {
    // 23505 = unique_violation: a concurrent auto-send won the race. Benign —
    // there is exactly one live auto invoice, which is the whole point.
    if (error.code === "23505") return "duplicate";
    if (!isMissingSchema(error)) {
      console.error("[payment-requests] createPaymentRequestSR failed:", error);
    }
    return null;
  }
  return data as PaymentRequest;
}

export async function getLatestPaymentRequestForEngagementSR(
  engagementId: string,
): Promise<PaymentRequest | null> {
  const sb = getServiceRoleSupabase();
  const { data, error } = await sb
    .from("payment_requests")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[payment-requests] getLatest(SR) failed:", error);
    }
    return null;
  }
  return (data as PaymentRequest) ?? null;
}

export async function attachCheckoutSessionSR(
  id: string,
  sessionId: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  await sb
    .from("payment_requests")
    .update({ stripe_checkout_session_id: sessionId })
    .eq("id", id);
}

// Mark a request paid. Idempotent: returns null (no-op) if the row is missing or
// already paid, so a re-delivered webhook can't double-process. Returns the
// row's firm/engagement/amount so the caller can log the activity.
export async function markPaymentRequestPaidSR(
  id: string,
  opts: { checkoutSessionId?: string | null; paymentIntentId?: string | null },
): Promise<{
  firmId: string;
  engagementId: string | null;
  amountCents: number;
  currency: string;
} | null> {
  const sb = getServiceRoleSupabase();
  const { data: cur } = await sb
    .from("payment_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!cur) return null;
  const row = cur as PaymentRequest;
  if (row.status === "paid") return null; // already processed
  const { error } = await sb
    .from("payment_requests")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      stripe_checkout_session_id:
        opts.checkoutSessionId ?? row.stripe_checkout_session_id,
      stripe_payment_intent_id:
        opts.paymentIntentId ?? row.stripe_payment_intent_id,
    })
    .eq("id", id);
  if (error) {
    console.error("[payment-requests] markPaid(SR) failed:", error);
    return null;
  }
  return {
    firmId: row.firm_id,
    engagementId: row.engagement_id,
    amountCents: row.amount_cents,
    currency: row.currency,
  };
}

// Mark a request failed (async payment failure). Never overwrites a paid row.
export async function markPaymentRequestFailedSR(
  id: string,
): Promise<{ firmId: string; engagementId: string | null } | null> {
  const sb = getServiceRoleSupabase();
  const { data: cur } = await sb
    .from("payment_requests")
    .select("firm_id, engagement_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!cur) return null;
  if ((cur as { status: string }).status === "paid") return null;
  await sb.from("payment_requests").update({ status: "failed" }).eq("id", id);
  return {
    firmId: (cur as { firm_id: string }).firm_id,
    engagementId: (cur as { engagement_id: string | null }).engagement_id,
  };
}

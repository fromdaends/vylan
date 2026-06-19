// Data layer for payment requests (Phase 3).
//
// Accountant-side reads/writes go through the RLS-scoped session client (firm
// members see only their own firm's rows). The client portal and the Stripe
// webhook use the service role elsewhere. Everything degrades gracefully before
// migration 0380 is applied to the remote DB (dev uses remote Supabase): a
// missing table/column is treated as "no payment requests yet" so the UI never
// hard-errors.

import { getServerSupabase } from "@/lib/supabase/server";

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
  created_at: string;
};

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
};

export async function createPaymentRequest(
  input: CreatePaymentRequestInput,
): Promise<PaymentRequest | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("payment_requests")
    .insert(input)
    .select("*")
    .single();
  if (error) {
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

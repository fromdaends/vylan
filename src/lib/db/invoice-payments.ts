// Data layer for the invoice payment ledger (migration 1240).
//
// One row per payment actually received against an invoice — the cheque, the
// Interac transfer, the card charge. The running total on
// payment_requests.amount_paid_cents is maintained by a database trigger, so
// nothing here ever writes it; inserting the ledger row IS the update.
//
// GATED like every post-launch table: dev and previews point at the prod DB, so
// a missing table/column is treated as "the ledger isn't live here yet" and the
// caller degrades rather than hard-errors. Error CODES only, never message text
// (the 0650 rule).

import { getServerSupabase, getServiceRoleSupabase } from "@/lib/supabase/server";

// How the money arrived. The two rails write their own rows at the paid flip;
// the rest are what a human recorded off a bank app or a cheque.
export type PaymentMethod =
  | "stripe"
  | "paypal"
  | "interac"
  | "cheque"
  | "cash"
  | "other";

// The ones a human can choose in the Record payment dialog. The rails are
// excluded on purpose: claiming a card payment by hand would put an invoice in
// a state no Stripe object backs.
export const MANUAL_PAYMENT_METHODS = [
  "interac",
  "cheque",
  "cash",
  "other",
] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export function isManualPaymentMethod(v: unknown): v is ManualPaymentMethod {
  return (
    typeof v === "string" &&
    (MANUAL_PAYMENT_METHODS as readonly string[]).includes(v)
  );
}

export const MAX_PAYMENT_REFERENCE = 300;

export type InvoicePayment = {
  id: string;
  firm_id: string;
  payment_request_id: string;
  client_id: string | null;
  engagement_id: string | null;
  amount_cents: number;
  method: PaymentMethod;
  paid_on: string;
  reference: string | null;
  recorded_by_user_id: string | null;
  created_at: string;
};

// PGRST205 / 42P01 = table missing, PGRST204 / 42703 = column missing. Both
// mean migration 1240 hasn't reached this database.
export function isLedgerSchemaMissing(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703"
  );
}

export type RecordPaymentInput = {
  firmId: string;
  paymentRequestId: string;
  clientId: string | null;
  engagementId: string | null;
  amountCents: number;
  method: PaymentMethod;
  paidOn: string;
  reference: string | null;
  recordedByUserId: string | null;
};

// Insert a ledger row (RLS-scoped — the accountant's own firm only). Returns
// the row, or "migration_pending" so the caller can say so plainly instead of
// reporting a save failure the founder would go hunting for.
export async function insertInvoicePayment(
  input: RecordPaymentInput,
): Promise<InvoicePayment | "migration_pending" | null> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("invoice_payments")
    .insert({
      firm_id: input.firmId,
      payment_request_id: input.paymentRequestId,
      client_id: input.clientId,
      engagement_id: input.engagementId,
      amount_cents: input.amountCents,
      method: input.method,
      paid_on: input.paidOn,
      reference: input.reference,
      recorded_by_user_id: input.recordedByUserId,
    })
    .select("*")
    .single();
  if (error) {
    if (isLedgerSchemaMissing(error)) return "migration_pending";
    console.error("[invoice-payments] insert failed:", error);
    return null;
  }
  return data as InvoicePayment;
}

// Service-role insert, for the rails: the Stripe/PayPal webhook has no user
// session. Best-effort by design — the payment is already recorded on the
// invoice by the time this runs, so a ledger failure must never propagate and
// turn a collected payment into an error. Returns whether the row landed.
export async function insertRailPaymentSR(
  input: RecordPaymentInput,
): Promise<boolean> {
  try {
    const sb = getServiceRoleSupabase();
    const { error } = await sb.from("invoice_payments").insert({
      firm_id: input.firmId,
      payment_request_id: input.paymentRequestId,
      client_id: input.clientId,
      engagement_id: input.engagementId,
      amount_cents: input.amountCents,
      method: input.method,
      paid_on: input.paidOn,
      reference: input.reference,
      recorded_by_user_id: null,
    });
    if (error) {
      if (!isLedgerSchemaMissing(error)) {
        console.error("[invoice-payments] rail insert failed:", error);
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error("[invoice-payments] rail insert threw:", err);
    return false;
  }
}

export type InvoicePaymentRow = InvoicePayment & {
  recordedByName: string | null;
};

// The payment history for one invoice, newest first, with the recorder's name
// resolved for display. Empty before 1240 is applied — which reads correctly as
// "no payments recorded", the truth on such a database.
export async function listInvoicePayments(
  paymentRequestId: string,
): Promise<InvoicePaymentRow[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("invoice_payments")
    .select("*")
    .eq("payment_request_id", paymentRequestId)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    if (!isLedgerSchemaMissing(error)) {
      console.error("[invoice-payments] list failed:", error);
    }
    return [];
  }
  const rows = (data ?? []) as InvoicePayment[];
  const userIds = [
    ...new Set(rows.map((r) => r.recorded_by_user_id).filter(Boolean)),
  ] as string[];
  const names = new Map<string, string>();
  if (userIds.length) {
    // RLS scopes users to the firm. Name preference mirrors userDisplayLabel:
    // display_name > name > email.
    const { data: users } = await sb
      .from("users")
      .select("id, name, display_name, email")
      .in("id", userIds);
    for (const u of users ?? []) {
      const label =
        (u.display_name as string | null)?.trim() ||
        (u.name as string | null)?.trim() ||
        (u.email as string | null) ||
        null;
      if (label) names.set(u.id as string, label);
    }
  }
  return rows.map((r) => ({
    ...r,
    recordedByName: r.recorded_by_user_id
      ? (names.get(r.recorded_by_user_id) ?? null)
      : null,
  }));
}

// Every payment across the firm in a date range, for the client statement.
// Scoped to one client's invoices by the caller passing their invoice ids.
export async function listPaymentsForInvoiceIds(
  invoiceIds: string[],
): Promise<Map<string, InvoicePayment[]>> {
  const out = new Map<string, InvoicePayment[]>();
  if (invoiceIds.length === 0) return out;
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("invoice_payments")
    .select("*")
    .in("payment_request_id", invoiceIds)
    .order("paid_on", { ascending: true });
  if (error) {
    if (!isLedgerSchemaMissing(error)) {
      console.error("[invoice-payments] listForInvoices failed:", error);
    }
    return out;
  }
  for (const row of (data ?? []) as InvoicePayment[]) {
    const list = out.get(row.payment_request_id);
    if (list) list.push(row);
    else out.set(row.payment_request_id, [row]);
  }
  return out;
}

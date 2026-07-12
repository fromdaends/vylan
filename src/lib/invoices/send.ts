// Invoice automation (migration 0590) — the single create-and-send path used
// by BOTH the completion hook (send on "Mark complete") and the scheduled cron
// worker (send N days later). Service-role, self-contained, and idempotent:
//
//   * loads the engagement / firm / client from trusted server state (never
//     client input), the same way processReminderJob does;
//   * gates on the firm having Stripe Connect charges enabled — no Connect,
//     no auto-invoice (silently, so completion never fails);
//   * needs an amount captured at setup (engagement.invoice_amount_cents);
//   * only fires for a still-complete engagement;
//   * NEVER double-sends: if any non-cancelled payment request already exists
//     for the engagement (auto OR manual), it skips.
//
// It reuses the exact same payment_requests row + "Pay now" portal email the
// manual "Request payment" button creates, so the client experience is
// identical.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  createPaymentRequestSR,
  getLatestPaymentRequestForEngagementSR,
} from "@/lib/db/payment-requests";
import { buildPaymentRequestEmail, sendEmail } from "@/lib/email";
import { getBrandingImageUrlForEmail } from "@/lib/storage";
import { formatCurrency } from "@/lib/format";

export type InvoiceSendReason =
  | "no_engagement"
  | "not_complete"
  | "not_connected"
  | "no_amount"
  | "already_sent"
  | "client_or_firm_missing"
  | "save_failed";

export type InvoiceSendResult =
  | { ok: true; paymentRequestId: string; emailSent: boolean }
  | { ok: false; reason: InvoiceSendReason };

// Send the invoice for one engagement. Safe to call more than once (idempotent).
export async function sendEngagementInvoice(
  engagementId: string,
): Promise<InvoiceSendResult> {
  const sb = getServiceRoleSupabase();

  const { data: engagement } = await sb
    .from("engagements")
    .select(
      "id, firm_id, client_id, title, status, magic_token, invoice_amount_cents",
    )
    .eq("id", engagementId)
    .maybeSingle();
  if (!engagement) return { ok: false, reason: "no_engagement" };

  // Only invoice finished work. The completion hook calls us right after the
  // status flips to complete; the delayed worker re-checks it here at fire time
  // (the accountant may have reopened it in the meantime).
  if (engagement.status !== "complete") {
    return { ok: false, reason: "not_complete" };
  }

  const amountCents = engagement.invoice_amount_cents as number | null;
  if (!amountCents || amountCents <= 0) {
    return { ok: false, reason: "no_amount" };
  }

  // Idempotency: never bill twice. Any existing non-cancelled request (a prior
  // auto-send, a job re-run, or a manual request) means we stop.
  const existing = await getLatestPaymentRequestForEngagementSR(engagementId);
  if (existing && existing.status !== "canceled") {
    return { ok: false, reason: "already_sent" };
  }

  const { data: firm } = await sb
    .from("firms")
    .select("name, logo_url, connect_charges_enabled")
    .eq("id", engagement.firm_id)
    .maybeSingle();
  // No Connect = the firm can't receive a payment; don't create a dead invoice.
  if (!firm || firm.connect_charges_enabled !== true) {
    return { ok: false, reason: "not_connected" };
  }

  const { data: client } = await sb
    .from("clients")
    .select("display_name, email, locale")
    .eq("id", engagement.client_id)
    .maybeSingle();
  if (!client) return { ok: false, reason: "client_or_firm_missing" };

  const row = await createPaymentRequestSR({
    firm_id: engagement.firm_id,
    engagement_id: engagement.id,
    client_id: engagement.client_id,
    amount_cents: amountCents,
    currency: "cad",
    description: null,
    // Show it in the portal AND email the pay link — this is an automatic ask,
    // so the client should be actively notified.
    delivery: "both",
    // No human requester: this was automated.
    requested_by_user_id: null,
  });
  if (!row) return { ok: false, reason: "save_failed" };

  // Best-effort email — a send failure never undoes the (recorded) invoice.
  let emailSent = false;
  if (client.email && engagement.magic_token) {
    try {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const locale = client.locale === "en" ? "en" : "fr";
      const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
      const email = buildPaymentRequestEmail({
        clientName: client.display_name,
        firmName: firm.name,
        firmLogoUrl,
        engagementTitle: engagement.title,
        amount: formatCurrency(amountCents / 100, locale),
        url: `${appUrl}/r/${engagement.magic_token}`,
        locale,
      });
      const res = await sendEmail({ to: client.email, ...email });
      emailSent = res.sent;
    } catch (e) {
      console.error("[invoices] auto-invoice email failed:", e);
    }
  }

  await sb.from("activity_log").insert({
    firm_id: engagement.firm_id,
    engagement_id: engagement.id,
    actor_type: "system",
    action: "payment_requested",
    metadata: {
      amount_cents: amountCents,
      currency: "cad",
      payment_request_id: row.id,
      auto: true,
      email_sent: emailSent,
    },
  });

  return { ok: true, paymentRequestId: row.id, emailSent };
}

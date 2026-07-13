// Create an invoice (a payment_request) for an engagement, on demand — shared by
// BOTH the "create it now" option on the New engagement page and the manual
// "Request payment" button. This is the one accountant-driven, RLS-scoped path
// for making an invoice at engagement CREATION or any time after (the automation
// in ./send handles the deferred on_completion / delayed case).
//
// It reuses the exact same payment_requests row + "Pay now" portal email, so the
// client experience is identical however the invoice was created.
//
// One invoice per engagement (v1): if a non-cancelled invoice already exists for
// the engagement, this refuses with "already_invoiced" rather than creating a
// second one.

import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getEngagement } from "@/lib/db/engagements";
import { getClient } from "@/lib/db/clients";
import {
  createPaymentRequest,
  getLatestPaymentRequestForEngagement,
  type PaymentDelivery,
} from "@/lib/db/payment-requests";
import { logUserActivity } from "@/lib/db/activity";
import { buildPaymentRequestEmail, sendEmail } from "@/lib/email";
import { getBrandingImageUrlForEmail } from "@/lib/storage";
import { formatCurrency } from "@/lib/format";

export type CreateInvoiceInput = {
  engagementId: string;
  amountCents: number;
  description?: string | null;
  delivery: PaymentDelivery;
  // Gate the engagement's Final documents until this invoice is paid.
  locksDeliverables?: boolean;
};

export type CreateInvoiceReason =
  | "unauthenticated"
  | "not_connected"
  | "not_found"
  | "invalid_amount"
  | "already_invoiced"
  | "save_failed";

export type CreateInvoiceResult =
  | { ok: true; id: string }
  | { ok: false; reason: CreateInvoiceReason };

// Stripe floor $0.50 up to ~$1M, integer cents.
function isValidAmount(cents: number): boolean {
  return Number.isInteger(cents) && cents >= 50 && cents <= 99_999_999;
}

export async function createInvoiceForEngagement(
  input: CreateInvoiceInput,
): Promise<CreateInvoiceResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, reason: "unauthenticated" };
  // Can't create a payable invoice until the firm can actually receive money.
  if (firm.connect_charges_enabled !== true) {
    return { ok: false, reason: "not_connected" };
  }
  if (!isValidAmount(input.amountCents)) {
    return { ok: false, reason: "invalid_amount" };
  }

  // RLS-scoped, plus an explicit firm check as defence in depth.
  const engagement = await getEngagement(input.engagementId);
  if (!engagement || engagement.firm_id !== firm.id) {
    return { ok: false, reason: "not_found" };
  }

  // One invoice per engagement (v1). A cancelled/waived invoice frees the slot
  // for a fresh one.
  const existing = await getLatestPaymentRequestForEngagement(engagement.id);
  if (existing && existing.status !== "canceled") {
    return { ok: false, reason: "already_invoiced" };
  }

  const description = input.description?.trim() ? input.description.trim() : null;
  const row = await createPaymentRequest({
    firm_id: firm.id,
    engagement_id: engagement.id,
    client_id: engagement.client_id,
    amount_cents: input.amountCents,
    currency: "cad",
    description,
    delivery: input.delivery,
    requested_by_user_id: user.id,
    locks_deliverables: input.locksDeliverables === true,
  });
  if (!row) return { ok: false, reason: "save_failed" };

  await logUserActivity(firm.id, engagement.id, "payment_requested", {
    amount_cents: input.amountCents,
    currency: "cad",
    payment_request_id: row.id,
    locks_deliverables: input.locksDeliverables === true,
  });

  // Email the pay link when the accountant chose email / both AND the engagement
  // has been sent (a draft has no magic_token / portal yet). Best-effort: an
  // email failure never undoes the recorded invoice.
  if (
    (input.delivery === "email" || input.delivery === "both") &&
    engagement.magic_token
  ) {
    try {
      const client = await getClient(engagement.client_id);
      if (client?.email) {
        const appUrl = process.env.APP_URL ?? "http://localhost:3000";
        const locale = client.locale === "en" ? "en" : "fr";
        const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
        const email = buildPaymentRequestEmail({
          clientName: client.display_name,
          firmName: firm.name,
          firmLogoUrl,
          engagementTitle: engagement.title,
          amount: formatCurrency(input.amountCents / 100, locale),
          url: `${appUrl}/r/${engagement.magic_token}`,
          locale,
        });
        await sendEmail({ to: client.email, ...email });
      }
    } catch (e) {
      console.error("[invoices] createInvoiceForEngagement email failed:", e);
    }
  }

  return { ok: true, id: row.id };
}

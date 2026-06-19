"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { getEngagement } from "@/lib/db/engagements";
import { getClient } from "@/lib/db/clients";
import { createPaymentRequest } from "@/lib/db/payment-requests";
import { logUserActivity } from "@/lib/db/activity";
import { buildPaymentRequestEmail, sendEmail } from "@/lib/email";
import { getBrandingImageUrlForEmail } from "@/lib/storage";
import { formatCurrency } from "@/lib/format";

export type RequestPaymentInput = {
  engagementId: string;
  amountCents: number;
  description?: string;
  delivery: "portal" | "email" | "both";
};

export type RequestPaymentResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// $0.50 Stripe minimum up to ~$1M, in integer cents — no floats.
const Schema = z.object({
  engagementId: z.string().regex(UUID_RE, "invalid_id"),
  amountCents: z.number().int("invalid_amount").min(50, "amount_too_small").max(99_999_999, "amount_too_large"),
  description: z.string().trim().max(500, "too_long").optional(),
  delivery: z.enum(["portal", "email", "both"]),
});

// Create a payment request against a (usually just-completed) engagement. The
// money will flow client -> the firm's connected Stripe account in Phase 4; here
// we only record the ask. Optional + gated on the firm having Connect ready.
export async function requestPaymentAction(
  input: RequestPaymentInput,
): Promise<RequestPaymentResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "unauthenticated" };
  // Can't request a payment until the firm can actually receive one.
  if (firm.connect_charges_enabled !== true) {
    return { ok: false, error: "not_connected" };
  }

  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  }

  // The engagement must belong to this firm. getEngagement is RLS-scoped, but
  // we check firm_id explicitly as defence in depth.
  const engagement = await getEngagement(parsed.data.engagementId);
  if (!engagement || engagement.firm_id !== firm.id) {
    return { ok: false, error: "not_found" };
  }

  const row = await createPaymentRequest({
    firm_id: firm.id,
    engagement_id: engagement.id,
    client_id: engagement.client_id,
    amount_cents: parsed.data.amountCents,
    currency: "cad",
    description: parsed.data.description?.trim() ? parsed.data.description.trim() : null,
    delivery: parsed.data.delivery,
    requested_by_user_id: user.id,
  });
  if (!row) return { ok: false, error: "save_failed" };

  await logUserActivity(firm.id, engagement.id, "payment_requested", {
    amount_cents: parsed.data.amountCents,
    currency: "cad",
    payment_request_id: row.id,
  });

  // Deliver the emailed pay link if the accountant chose email / both. The CTA
  // opens the firm-branded portal where the Pay now card lives. Best-effort: a
  // send failure never fails the request (the row is what matters).
  if (
    (parsed.data.delivery === "email" || parsed.data.delivery === "both") &&
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
          amount: formatCurrency(parsed.data.amountCents / 100, locale),
          url: `${appUrl}/r/${engagement.magic_token}`,
          locale,
        });
        await sendEmail({ to: client.email, ...email });
      }
    } catch (e) {
      console.error("[requestPaymentAction] payment email failed:", e);
    }
  }

  revalidatePath(`/engagements/${engagement.id}`);
  return { ok: true, id: row.id };
}

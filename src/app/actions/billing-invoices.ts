"use server";

// Server actions behind Billing → Invoices.
//
// Every one of these is a thin wrapper: the decisions live in lib/invoices/*
// so the same rules apply however they are reached. What this file adds is the
// firm/capability gate, the revalidate, and a discriminated result the UI can
// turn into a specific message rather than a shrug.

import { revalidatePath } from "next/cache";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import {
  getPaymentRequestById,
  cancelPaymentRequest,
  setInvoiceAutoChase,
} from "@/lib/db/payment-requests";
import { isManualPaymentMethod } from "@/lib/invoices/filters";
import {
  recordManualPayment,
  type RecordPaymentReason,
} from "@/lib/invoices/record-payment";
import {
  sendInvoiceReminder,
  cancelInvoiceChase,
  rescheduleInvoiceChase,
} from "@/lib/invoices/chase";
import {
  getChaseSettings,
  updateChaseSettings,
  updateDefaultDueDays,
} from "@/lib/db/invoice-settings";
import { logUserActivity } from "@/lib/db/activity";
import { outstandingCents } from "@/lib/invoices/outstanding";
import { getServerSupabase } from "@/lib/supabase/server";
import { chaseSettingsWithFlowOverride } from "@/lib/invoices/chase-flow";

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; reason: string };

// money.view is the capability every money surface already gates on. Owners and
// members have it; it is deliberately NOT billing.manage, which is the
// owner-only gate on the Vylan SUBSCRIPTION page and would lock staff out of
// doing their job.
async function requireMoneyAccess(): Promise<
  { firmId: string } | { error: string }
> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { error: "unauthenticated" };
  if (!can(user, "money.view")) return { error: "forbidden" };
  return { firmId: firm.id };
}

// Defence in depth: RLS already scopes reads to the firm, but an id from a
// form post is client input and every action here re-checks it belongs to us.
async function ownedInvoice(id: string, firmId: string) {
  const invoice = await getPaymentRequestById(id);
  if (!invoice || invoice.firm_id !== firmId) return null;
  return invoice;
}

export async function recordPaymentAction(input: {
  invoiceId: string;
  amountCents: number;
  method: string;
  paidOn: string;
  reference?: string | null;
}): Promise<
  | { ok: true; settled: boolean; outstandingCents: number }
  | { ok: false; reason: RecordPaymentReason | "forbidden" }
> {
  const gate = await requireMoneyAccess();
  if ("error" in gate) {
    return { ok: false, reason: gate.error as "forbidden" };
  }
  if (!isManualPaymentMethod(input.method)) {
    return { ok: false, reason: "invalid_amount" };
  }
  const result = await recordManualPayment({
    paymentRequestId: input.invoiceId,
    amountCents: input.amountCents,
    method: input.method,
    paidOn: input.paidOn,
    reference: input.reference ?? null,
  });
  if (!result.ok) return result;
  revalidatePath("/billing");
  return {
    ok: true,
    settled: result.settled,
    outstandingCents: result.outstandingCents,
  };
}

export async function remindInvoiceNowAction(
  invoiceId: string,
): Promise<ActionResult> {
  const gate = await requireMoneyAccess();
  if ("error" in gate) return { ok: false, reason: gate.error };
  const invoice = await ownedInvoice(invoiceId, gate.firmId);
  if (!invoice) return { ok: false, reason: "not_found" };

  // occurrence 0 marks a hand-sent nudge in the activity metadata, so the feed
  // can tell "the firm chased them" from "the cadence fired".
  const result = await sendInvoiceReminder(invoiceId, 0);
  if (!result.sent) return { ok: false, reason: result.skipped };

  // "Resets the cadence clock" — the queued reminders are replaced by a fresh
  // run starting today, so the client does not get an automatic one tomorrow
  // on top of the manual nudge they just received. The rebuild keeps the
  // FLOW's cadence when the engagement's flow carries one — without this, a
  // single "Remind now" silently reverted the invoice to firm defaults for
  // the rest of its life.
  const settings = await chaseSettingsWithFlowOverride(
    await getServerSupabase(),
    {
      base: await getChaseSettings(),
      engagementId: invoice.engagement_id ?? null,
      firmId: gate.firmId,
    },
  );
  await rescheduleInvoiceChase({ invoiceId, settings });
  revalidatePath("/billing");
  return { ok: true };
}

export async function setAutoChaseAction(
  invoiceId: string,
  on: boolean,
): Promise<ActionResult> {
  const gate = await requireMoneyAccess();
  if ("error" in gate) return { ok: false, reason: gate.error };
  const invoice = await ownedInvoice(invoiceId, gate.firmId);
  if (!invoice) return { ok: false, reason: "not_found" };

  const changed = await setInvoiceAutoChase(invoiceId, on);
  if (!changed) return { ok: false, reason: "migration_pending" };

  if (on) {
    // Switching chasing back on restarts the cadence from today rather than
    // replaying a schedule anchored to a due date that may be long past —
    // per the FLOW's cadence when the engagement's flow carries one, same
    // resolution as send-time and "Remind now".
    const settings = await chaseSettingsWithFlowOverride(
      await getServerSupabase(),
      {
        base: await getChaseSettings(),
        engagementId: invoice.engagement_id ?? null,
        firmId: gate.firmId,
      },
    );
    await rescheduleInvoiceChase({ invoiceId, settings });
  } else {
    // The worker would skip these anyway (it re-reads auto_chase), but leaving
    // dead jobs in the queue makes it harder to see what is actually pending.
    await cancelInvoiceChase(invoiceId);
  }

  await logUserActivity(gate.firmId, invoice.engagement_id, "invoice_chase_toggled", {
    payment_request_id: invoiceId,
    auto_chase: on,
  });
  revalidatePath("/billing");
  return { ok: true };
}

export async function voidInvoiceAction(
  invoiceId: string,
): Promise<ActionResult> {
  const gate = await requireMoneyAccess();
  if ("error" in gate) return { ok: false, reason: gate.error };
  const invoice = await ownedInvoice(invoiceId, gate.firmId);
  if (!invoice) return { ok: false, reason: "not_found" };
  if (invoice.status === "paid") return { ok: false, reason: "already_paid" };

  // cancelPaymentRequest is the SAME writer the engagement-side "waive invoice"
  // uses, and it never overwrites a paid row. Voiding is not deleting: the row,
  // its number and its history all stay.
  const done = await cancelPaymentRequest(invoiceId);
  if (!done) return { ok: false, reason: "already_paid" };

  await cancelInvoiceChase(invoiceId);
  await logUserActivity(gate.firmId, invoice.engagement_id, "invoice_voided", {
    payment_request_id: invoiceId,
    invoice_number: invoice.invoice_number ?? null,
    // What was still owed at the moment it was voided — the number that makes
    // this entry answerable later ("we wrote off $1,400 that quarter").
    written_off_cents: outstandingCents(invoice),
  });
  revalidatePath("/billing");
  return { ok: true };
}

// null = "don't put a due date on my invoices at all", which is a real choice
// and deliberately distinct from 0 (due on receipt).
export async function saveDefaultDueDaysAction(
  days: number | null,
): Promise<ActionResult> {
  const gate = await requireMoneyAccess();
  if ("error" in gate) return { ok: false, reason: gate.error };
  const result = await updateDefaultDueDays(days);
  if (!result.ok) return { ok: false, reason: result.reason };
  // Only the Billing surfaces read this; an invoice already issued keeps the
  // date it was issued with, so nothing else needs revalidating.
  revalidatePath("/billing");
  return { ok: true };
}

export async function saveChaseSettingsAction(input: {
  enabledDefault: boolean;
  intervalDays: number;
  maxReminders: number;
}): Promise<ActionResult> {
  const gate = await requireMoneyAccess();
  if ("error" in gate) return { ok: false, reason: gate.error };
  const result = await updateChaseSettings(input);
  if (!result.ok) return { ok: false, reason: result.reason };
  revalidatePath("/billing");
  return { ok: true };
}

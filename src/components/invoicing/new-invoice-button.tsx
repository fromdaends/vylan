import { getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { firmPaymentRails } from "@/lib/payments/rails";
import { NewInvoicePicker } from "./new-invoice-picker";

// "New invoice" — an ENGAGEMENT picker, not an invoice form.
//
// Invoices in Vylan belong to an engagement: createInvoiceForEngagement takes
// an engagementId, derives the client from it, and a database unique index caps
// it at one live invoice per engagement. So the honest firm-level entry point
// is "which engagement are you billing?", and choosing one lands on that
// engagement with the existing invoice dialog already open. There is one
// invoice creation path in this app and this button walks you to it rather
// than reimplementing it.
//
// Hidden entirely when no rail can receive money: createInvoiceForEngagement
// would refuse with not_connected, and offering a button that always fails is
// worse than not offering it.
export async function NewInvoiceButton() {
  const firm = await getCurrentFirm();
  if (!firm || !firmPaymentRails(firm).any) return null;

  const t = await getTranslations("FirmBilling");
  const engagements = await listInvoiceableEngagements();

  return (
    <NewInvoicePicker
      engagements={engagements}
      labels={{
        button: t("new_invoice"),
        title: t("new_invoice_pick"),
        hint: t("new_invoice_pick_hint"),
        empty: t("new_invoice_none"),
        search: t("new_invoice_search"),
        cancel: t("cancel"),
        pick: t("new_invoice_pick_label"),
        footnote: t("new_invoice_footnote"),
        draft: t("new_invoice_draft"),
      }}
    />
  );
}

export type InvoiceableEngagement = {
  id: string;
  title: string;
  clientName: string | null;
};

// Engagements that can still be invoiced: not cancelled, and without a live
// invoice already. A cancelled invoice frees the slot, which is why the filter
// is "has a non-cancelled invoice" rather than "has any invoice".
async function listInvoiceableEngagements(): Promise<InvoiceableEngagement[]> {
  const sb = await getServerSupabase();
  const [{ data: engagements }, { data: invoices }] = await Promise.all([
    sb
      .from("engagements")
      .select("id, title, client_id, status")
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(300),
    sb
      .from("payment_requests")
      .select("engagement_id, status")
      .neq("status", "canceled"),
  ]);

  const taken = new Set(
    (invoices ?? [])
      .map((r) => r.engagement_id as string | null)
      .filter(Boolean) as string[],
  );
  const open = (engagements ?? []).filter((e) => !taken.has(e.id as string));
  if (open.length === 0) return [];

  const clientIds = [
    ...new Set(open.map((e) => e.client_id).filter(Boolean)),
  ] as string[];
  const names = new Map<string, string>();
  if (clientIds.length) {
    const { data } = await sb
      .from("clients")
      .select("id, display_name")
      .in("id", clientIds);
    for (const c of data ?? [])
      names.set(c.id as string, c.display_name as string);
  }

  return open.map((e) => ({
    id: e.id as string,
    title: e.title as string,
    clientName: e.client_id
      ? (names.get(e.client_id as string) ?? null)
      : null,
  }));
}

// The firm-wide invoice list behind Billing → Invoices.
//
// Every filter is applied IN THE DATABASE. That matters more than it looks: the
// alternative — fetch a page, then drop rows in JS that don't match — silently
// returns short pages and a "Next" button that lies. So each display status is
// expressed as real column predicates below, and the one thing that makes that
// possible is an invariant the write side guarantees:
//
//   an invoice whose payments cover it is ALWAYS status 'paid'.
//
// recordManualPayment flips the status in the same call that inserts the last
// ledger row, so "status = requested AND fully covered" is a state that cannot
// persist. Without that, "overdue" would need a column-vs-column comparison
// PostgREST cannot express.
//
// Joins are resolved in JS (this repo has no PostgREST embeds), batched — never
// one query per row.

import { getServerSupabase } from "@/lib/supabase/server";
import {
  invoiceDisplayStatus,
  isoDay,
  outstandingCents,
  type InvoiceDisplayStatus,
  type InvoiceStateInput,
  type StoredInvoiceStatus,
} from "@/lib/invoices/outstanding";
import type { PaymentMethod } from "@/lib/db/invoice-payments";

export const INVOICE_PAGE_SIZE = 25;

// The filter values the UI offers. "all" is absence of a filter, kept explicit
// so the query-string round-trip has something to say.
export const INVOICE_STATUS_FILTERS = [
  "all",
  "unpaid",
  "partly_paid",
  "overdue",
  "paid",
  "failed",
  "void",
] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number];

export function isInvoiceStatusFilter(v: unknown): v is InvoiceStatusFilter {
  return (
    typeof v === "string" &&
    (INVOICE_STATUS_FILTERS as readonly string[]).includes(v)
  );
}

export type InvoiceListFilters = {
  status: InvoiceStatusFilter;
  clientId: string | null;
  // Inclusive ISO days against issue_date, falling back to created_at for rows
  // that predate native invoices and have no issue_date.
  from: string | null;
  to: string | null;
  search: string | null;
  page: number;
};

export type InvoiceListRow = {
  id: string;
  invoiceNumber: string | null;
  invoiceKind: "generated" | "attached" | null;
  clientId: string | null;
  clientName: string | null;
  engagementId: string | null;
  engagementTitle: string | null;
  amountCents: number;
  taxTotalCents: number | null;
  amountPaidCents: number;
  outstandingCents: number;
  currency: string;
  issuedOn: string;
  dueDate: string | null;
  status: InvoiceDisplayStatus;
  // How the money arrived, once it has. Null while unpaid.
  paymentMethod: PaymentMethod | null;
  autoChase: boolean;
  chaseCount: number;
  lastChasedAt: string | null;
};

export type InvoiceListResult = {
  rows: InvoiceListRow[];
  page: number;
  hasNext: boolean;
  // True when migration 1240 hasn't reached this database: the list still
  // renders from the legacy columns, and the UI says so rather than showing
  // every invoice as fully outstanding.
  migrationPending: boolean;
};

const LEGACY_COLS =
  "id, client_id, engagement_id, amount_cents, currency, status, created_at, " +
  "invoice_number, invoice_kind, issue_date, due_date, tax_total_cents, " +
  "paid_at, paid_provider";
const WITH_1240_COLS = `${LEGACY_COLS}, amount_paid_cents, auto_chase, chase_count, last_chased_at`;

function isMissingColumn(err: { code?: string } | null): boolean {
  return err?.code === "PGRST204" || err?.code === "42703";
}

export async function listFirmInvoices(
  filters: InvoiceListFilters,
  today: Date = new Date(),
): Promise<InvoiceListResult> {
  const sb = await getServerSupabase();
  const page = Math.max(1, filters.page);
  const offset = (page - 1) * INVOICE_PAGE_SIZE;
  const todayIso = isoDay(today);

  // A search term that looks like a client name has to become client ids before
  // the invoice query runs — there is no join to search across.
  let searchClientIds: string[] | null = null;
  const search = filters.search?.trim() || null;
  if (search) {
    const { data } = await sb
      .from("clients")
      .select("id")
      .ilike("display_name", `%${search}%`)
      .limit(200);
    searchClientIds = (data ?? []).map((c) => c.id as string);
  }

  const run = async (cols: string) => {
    let q = sb.from("payment_requests").select(cols);

    // ── Status ───────────────────────────────────────────────────────────
    // Each branch mirrors invoiceDisplayStatus exactly, including its
    // precedence (overdue outranks failed and partly-paid).
    switch (filters.status) {
      case "paid":
        q = q.eq("status", "paid");
        break;
      case "void":
        q = q.eq("status", "canceled");
        break;
      case "overdue":
        q = q
          .in("status", ["requested", "failed"])
          .not("due_date", "is", null)
          .lt("due_date", todayIso);
        break;
      case "failed":
        q = q
          .eq("status", "failed")
          .or(`due_date.is.null,due_date.gte.${todayIso}`);
        break;
      case "unpaid":
        q = q
          .eq("status", "requested")
          .eq("amount_paid_cents", 0)
          .or(`due_date.is.null,due_date.gte.${todayIso}`);
        break;
      case "partly_paid":
        q = q
          .eq("status", "requested")
          .gt("amount_paid_cents", 0)
          .or(`due_date.is.null,due_date.gte.${todayIso}`);
        break;
      default:
        break;
    }

    if (filters.clientId) q = q.eq("client_id", filters.clientId);

    // ── Date range ───────────────────────────────────────────────────────
    // issue_date is the invoice's own date and is null on pre-0750 rows, so
    // the range is applied to a coalesced day. PostgREST can't coalesce in a
    // filter, so the range covers issue_date OR (issue_date null AND
    // created_at in range) — expressed as an `or` group.
    if (filters.from) {
      q = q.or(
        `issue_date.gte.${filters.from},and(issue_date.is.null,created_at.gte.${filters.from}T00:00:00Z)`,
      );
    }
    if (filters.to) {
      q = q.or(
        `issue_date.lte.${filters.to},and(issue_date.is.null,created_at.lte.${filters.to}T23:59:59Z)`,
      );
    }

    // ── Search ───────────────────────────────────────────────────────────
    if (search) {
      const clauses = [`invoice_number.ilike.%${search}%`];
      if (searchClientIds && searchClientIds.length > 0) {
        clauses.push(`client_id.in.(${searchClientIds.join(",")})`);
      }
      q = q.or(clauses.join(","));
    }

    // Newest first. issue_date can be null on legacy rows, so created_at is
    // the stable tiebreaker AND the fallback ordering key.
    return q
      .order("created_at", { ascending: false })
      .range(offset, offset + INVOICE_PAGE_SIZE); // one extra row = hasNext
  };

  let migrationPending = false;
  let { data, error } = await run(WITH_1240_COLS);
  if (error && isMissingColumn(error)) {
    migrationPending = true;
    ({ data, error } = await run(LEGACY_COLS));
    // The status filters that reference amount_paid_cents cannot run at all
    // pre-1240. Falling back to the plain unpaid set is the honest answer: on
    // such a database no invoice is partly paid, because none can be.
    if (error && isMissingColumn(error)) {
      ({ data, error } = await sb
        .from("payment_requests")
        .select(LEGACY_COLS)
        .order("created_at", { ascending: false })
        .range(offset, offset + INVOICE_PAGE_SIZE));
    }
  }
  if (error) {
    console.error("[invoices/list] query failed:", error);
    return { rows: [], page, hasNext: false, migrationPending };
  }

  const raw = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const hasNext = raw.length > INVOICE_PAGE_SIZE;
  const pageRows = hasNext ? raw.slice(0, INVOICE_PAGE_SIZE) : raw;

  const rows = await decorate(pageRows, today);
  return { rows, page, hasNext, migrationPending };
}

// Resolve client + engagement names for a page of invoices in two queries.
async function decorate(
  raw: Array<Record<string, unknown>>,
  today: Date,
): Promise<InvoiceListRow[]> {
  if (raw.length === 0) return [];
  const sb = await getServerSupabase();
  const clientIds = [
    ...new Set(raw.map((r) => r.client_id).filter(Boolean)),
  ] as string[];
  const engIds = [
    ...new Set(raw.map((r) => r.engagement_id).filter(Boolean)),
  ] as string[];

  const clientName = new Map<string, string>();
  const engTitle = new Map<string, string>();
  // paid_provider says 'manual' for anything that wasn't a rail, which is not
  // what the firm wants to read in a table — "was that the cheque or the
  // e-transfer?" is the whole question. The ledger holds the real method, so
  // the paid rows on this page get theirs in one batched query.
  const methodByInvoice = new Map<string, PaymentMethod>();
  const paidIds = raw
    .filter((r) => r.status === "paid")
    .map((r) => r.id as string);

  await Promise.all([
    clientIds.length
      ? sb
          .from("clients")
          .select("id, display_name")
          .in("id", clientIds)
          .then(({ data }) => {
            for (const c of data ?? [])
              clientName.set(c.id as string, c.display_name as string);
          })
      : Promise.resolve(),
    engIds.length
      ? sb
          .from("engagements")
          .select("id, title")
          .in("id", engIds)
          .then(({ data }) => {
            for (const e of data ?? [])
              engTitle.set(e.id as string, e.title as string);
          })
      : Promise.resolve(),
    paidIds.length
      ? sb
          .from("invoice_payments")
          .select("payment_request_id, method, paid_on")
          .in("payment_request_id", paidIds)
          .order("paid_on", { ascending: false })
          .then(({ data }) => {
            // Newest first, so the first row seen per invoice is the one that
            // settled it. An invoice paid by two methods reports the last one.
            for (const p of data ?? []) {
              const key = p.payment_request_id as string;
              if (!methodByInvoice.has(key)) {
                methodByInvoice.set(key, p.method as PaymentMethod);
              }
            }
          })
      : Promise.resolve(),
  ]);

  return raw.map((r) => {
    const state: InvoiceStateInput & { amount_paid_cents: number } = {
      status: r.status as StoredInvoiceStatus,
      amount_cents: r.amount_cents as number,
      amount_paid_cents: (r.amount_paid_cents as number | undefined) ?? 0,
      due_date: (r.due_date as string | null) ?? null,
    };
    const clientId = (r.client_id as string | null) ?? null;
    const engagementId = (r.engagement_id as string | null) ?? null;
    return {
      id: r.id as string,
      invoiceNumber: (r.invoice_number as string | null) ?? null,
      invoiceKind:
        (r.invoice_kind as "generated" | "attached" | null) ?? null,
      clientId,
      clientName: clientId ? (clientName.get(clientId) ?? null) : null,
      engagementId,
      engagementTitle: engagementId
        ? (engTitle.get(engagementId) ?? null)
        : null,
      amountCents: state.amount_cents,
      taxTotalCents: (r.tax_total_cents as number | null) ?? null,
      amountPaidCents: state.amount_paid_cents,
      outstandingCents: outstandingCents(state),
      currency: (r.currency as string) ?? "cad",
      // The invoice's own date when it has one, else the day the row was made.
      issuedOn:
        (r.issue_date as string | null) ??
        String(r.created_at ?? "").slice(0, 10),
      dueDate: (r.due_date as string | null) ?? null,
      status: invoiceDisplayStatus(state, today),
      paymentMethod:
        state.status === "paid"
          ? // The ledger's method when it has one; otherwise the rail on the
            // invoice, which is all a pre-1240 paid row can tell us.
            (methodByInvoice.get(r.id as string) ??
            (r.paid_provider as PaymentMethod | null) ??
            null)
          : null,
      autoChase: (r.auto_chase as boolean | undefined) ?? true,
      chaseCount: (r.chase_count as number | undefined) ?? 0,
      lastChasedAt: (r.last_chased_at as string | null) ?? null,
    };
  });
}

// How Billing's filters are
// read out of the query string.
//
// Pure and neutral (no "use client"), so the server page and the client filter
// bar parse the same URL the same way. Every filter lives in the URL rather
// than component state: it makes the list linkable ("here are Acme's overdue
// invoices"), survives a refresh, and lets pagination be plain <Link>s.

import {
  INVOICE_STATUS_FILTERS,
  isInvoiceStatusFilter,
  type InvoiceListFilters,
  type InvoiceStatusFilter,
} from "@/lib/invoices/filters";



const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function cleanDay(v: string | undefined): string | null {
  const s = v?.trim();
  return s && ISO_DAY.test(s) ? s : null;
}

export function resolveInvoiceFilters(
  sp: Record<string, string | undefined>,
): InvoiceListFilters {
  const page = Number(sp.page);
  let from = cleanDay(sp.from);
  let to = cleanDay(sp.to);
  // A backwards range returns nothing and reads as a bug in the list rather
  // than a typo in the dates. Swapping them is what the person meant.
  if (from && to && from > to) [from, to] = [to, from];
  return {
    status: isInvoiceStatusFilter(sp.status) ? sp.status : "all",
    clientId: sp.client?.trim() || null,
    from,
    to,
    search: sp.q?.trim() || null,
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
  };
}

// Rebuild the query string with one thing changed. Used by every filter
// control and both pagination links, so "change the status" can never
// accidentally drop the client filter.
export function billingHref(
  filters: InvoiceListFilters,
  change: Partial<InvoiceListFilters> = {},
): string {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  if (next.status !== "all") params.set("status", next.status);
  if (next.clientId) params.set("client", next.clientId);
  if (next.from) params.set("from", next.from);
  if (next.to) params.set("to", next.to);
  if (next.search) params.set("q", next.search);
  // Any change to the filters resets to page 1 — staying on page 4 of a
  // narrower result set is how you land on an empty list and think it broke.
  const page =
    change.page ?? (hasFilterChange(change) ? 1 : next.page);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/billing?${qs}` : "/billing";
}

function hasFilterChange(change: Partial<InvoiceListFilters>): boolean {
  return (
    "status" in change ||
    "clientId" in change ||
    "from" in change ||
    "to" in change ||
    "search" in change
  );
}

export function hasAnyFilter(f: InvoiceListFilters): boolean {
  return Boolean(
    f.status !== "all" || f.clientId || f.from || f.to || f.search,
  );
}

export { INVOICE_STATUS_FILTERS };
export type { InvoiceStatusFilter, InvoiceListFilters };

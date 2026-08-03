// The statement of account: what one client owes, across every invoice in a
// date range.
//
// This is the answer to "what do I owe you?" that firms currently assemble by
// hand from a spreadsheet and their memory. Deliberately a SUMMARY, not a
// re-issue: one line per invoice, its status, and what is still outstanding on
// it. The invoice itself remains the document of record and is unchanged.
//
// Pure model, no rendering and no database — the same split the invoice PDF
// uses (pdf-model.ts / pdf.tsx), so the arithmetic below is testable without a
// PDF renderer anywhere near it.

import { pdfMoney, pdfDate, type InvoicePdfLanguage } from "./pdf-model";
import { outstandingCents, type InvoiceStateInput } from "./outstanding";

export type StatementLineStatus = "paid" | "partly_paid" | "unpaid" | "overdue";

export type StatementLine = {
  invoiceNumber: string | null;
  issuedOn: string;
  dueDate: string | null;
  engagementTitle: string | null;
  totalCents: number;
  paidCents: number;
  outstandingCents: number;
  status: StatementLineStatus;
};

export type StatementModel = {
  language: InvoicePdfLanguage;
  firmName: string;
  firmAddressLines: string[];
  firmContactLine: string | null;
  brandColor: string;
  logoDataUri: string | null;
  clientName: string;
  from: string | null;
  to: string | null;
  generatedOn: string;
  lines: StatementLine[];
  totalBilledCents: number;
  totalPaidCents: number;
  totalOwingCents: number;
};

// VOID INVOICES ARE NOT ON THE STATEMENT. A statement is a demand for money;
// listing an invoice the firm has already cancelled invites exactly the phone
// call it is meant to prevent. They stay in Billing, where the history lives.
export type StatementInvoiceInput = InvoiceStateInput & {
  invoice_number: string | null;
  issue_date: string | null;
  created_at: string;
  engagement_title: string | null;
};

export function buildStatementLines(
  invoices: StatementInvoiceInput[],
  today: Date = new Date(),
): StatementLine[] {
  const todayIso = today.toISOString().slice(0, 10);
  return invoices
    .filter((inv) => inv.status !== "canceled")
    .map((inv) => {
      const owing = outstandingCents(inv);
      const paid = inv.amount_cents - owing;
      let status: StatementLineStatus;
      if (owing === 0) status = "paid";
      else if (inv.due_date && todayIso > inv.due_date) status = "overdue";
      else if (paid > 0) status = "partly_paid";
      else status = "unpaid";
      return {
        invoiceNumber: inv.invoice_number,
        issuedOn: inv.issue_date ?? inv.created_at.slice(0, 10),
        dueDate: inv.due_date ?? null,
        engagementTitle: inv.engagement_title,
        totalCents: inv.amount_cents,
        paidCents: paid,
        outstandingCents: owing,
        status,
      };
    })
    // Oldest first: a statement reads as a history, and the oldest unpaid
    // invoice is the one the conversation is actually about.
    .sort((a, b) => a.issuedOn.localeCompare(b.issuedOn));
}

export function statementTotals(lines: StatementLine[]): {
  totalBilledCents: number;
  totalPaidCents: number;
  totalOwingCents: number;
} {
  return lines.reduce(
    (acc, l) => ({
      totalBilledCents: acc.totalBilledCents + l.totalCents,
      totalPaidCents: acc.totalPaidCents + l.paidCents,
      totalOwingCents: acc.totalOwingCents + l.outstandingCents,
    }),
    { totalBilledCents: 0, totalPaidCents: 0, totalOwingCents: 0 },
  );
}

export const STATEMENT_LABELS: Record<
  InvoicePdfLanguage,
  {
    title: string;
    forClient: string;
    period: string;
    allTime: string;
    generated: string;
    invoice: string;
    issued: string;
    due: string;
    total: string;
    paid: string;
    owing: string;
    status: string;
    totalBilled: string;
    totalPaid: string;
    totalOwing: string;
    nothingOwed: string;
    empty: string;
    statusPaid: string;
    statusPartly: string;
    statusUnpaid: string;
    statusOverdue: string;
    range: (from: string, to: string) => string;
    since: (from: string) => string;
    until: (to: string) => string;
  }
> = {
  en: {
    title: "STATEMENT OF ACCOUNT",
    forClient: "Account of",
    period: "Period",
    allTime: "All invoices to date",
    generated: "Generated",
    invoice: "Invoice",
    issued: "Issued",
    due: "Due",
    total: "Total",
    paid: "Paid",
    owing: "Owing",
    status: "Status",
    totalBilled: "Total billed",
    totalPaid: "Total paid",
    totalOwing: "Balance owing",
    nothingOwed: "Your account is fully settled. Thank you.",
    empty: "No invoices in this period.",
    statusPaid: "Paid",
    statusPartly: "Part paid",
    statusUnpaid: "Unpaid",
    statusOverdue: "Overdue",
    range: (from, to) => `${from} to ${to}`,
    since: (from) => `From ${from}`,
    until: (to) => `Up to ${to}`,
  },
  fr: {
    title: "ÉTAT DE COMPTE",
    forClient: "Compte de",
    period: "Période",
    allTime: "Toutes les factures à ce jour",
    generated: "Généré le",
    invoice: "Facture",
    issued: "Émise",
    due: "Échéance",
    total: "Total",
    paid: "Payé",
    owing: "Solde",
    status: "Statut",
    totalBilled: "Total facturé",
    totalPaid: "Total payé",
    totalOwing: "Solde dû",
    nothingOwed: "Votre compte est entièrement réglé. Merci.",
    empty: "Aucune facture pour cette période.",
    statusPaid: "Payée",
    statusPartly: "Partielle",
    statusUnpaid: "Impayée",
    statusOverdue: "En retard",
    range: (from, to) => `${from} au ${to}`,
    since: (from) => `À partir du ${from}`,
    until: (to) => `Jusqu'au ${to}`,
  },
};

export function statementPeriodLabel(
  model: Pick<StatementModel, "from" | "to" | "language">,
): string {
  const L = STATEMENT_LABELS[model.language];
  const { from, to, language } = model;
  if (from && to) {
    return L.range(pdfDate(from, language), pdfDate(to, language));
  }
  if (from) return L.since(pdfDate(from, language));
  if (to) return L.until(pdfDate(to, language));
  return L.allTime;
}

export function statementStatusLabel(
  status: StatementLineStatus,
  language: InvoicePdfLanguage,
): string {
  const L = STATEMENT_LABELS[language];
  switch (status) {
    case "paid":
      return L.statusPaid;
    case "partly_paid":
      return L.statusPartly;
    case "overdue":
      return L.statusOverdue;
    default:
      return L.statusUnpaid;
  }
}

// A statement's filename is the thing the client saves to their desktop, so it
// carries the firm and the date rather than a uuid.
export function statementFilename(model: StatementModel): string {
  const safeClient = model.clientName
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const stem = model.language === "fr" ? "etat-de-compte" : "statement";
  return `${stem}-${safeClient || "client"}-${model.generatedOn}.pdf`;
}

export { pdfMoney, pdfDate };

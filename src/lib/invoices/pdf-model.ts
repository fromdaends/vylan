// Pure assembly of everything the invoice PDF (and the portal detail) needs —
// separated from the renderer so it's testable without producing a document.
// Bilingual by design: every label the DOCUMENT prints lives here (not in
// messages/*.json) because the renderer runs server-side from routes and the
// paid-time freeze hook, where the request has no locale context.

import { safeStorageName } from "@/lib/files/safe-name";
import {
  parseStoredLineItems,
  parseStoredTaxLines,
  type FrozenTaxLine,
  type InvoiceLineItem,
} from "@/lib/invoices/totals";
import { taxComponentLabel } from "@/lib/tax/canada";
import type { PaymentRequest } from "@/lib/db/payment-requests";
import type { FirmInvoiceSettings } from "@/lib/db/invoice-settings";

export type InvoicePdfLanguage = "en" | "fr";

export type InvoicePdfModel = {
  language: InvoicePdfLanguage;
  firmName: string;
  // Multi-line postal address (already split on newlines) + one contact line.
  firmAddressLines: string[];
  firmContactLine: string | null;
  // Brand accent (validated hex — falls back to the app's slate ink).
  brandColor: string;
  // JPEG/PNG data URI, or null → name-only header.
  logoDataUri: string | null;
  clientName: string | null;
  engagementTitle: string | null;
  invoiceNumber: string | null;
  issueDate: string | null; // YYYY-MM-DD
  dueDate: string | null;
  lines: InvoiceLineItem[];
  taxLines: FrozenTaxLine[];
  subtotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  terms: string | null;
  notes: string | null;
  paid: boolean;
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FALLBACK_INK = "#0f172a";

// A line the accountant left description-less prints with this fallback so the
// document never shows a blank cell.
export function lineDescriptionForDisplay(
  description: string,
  language: InvoicePdfLanguage,
): string {
  if (description.trim() !== "") return description;
  return language === "fr" ? "Services professionnels" : "Professional services";
}

// The document's fixed labels, both languages.
export const PDF_LABELS: Record<
  InvoicePdfLanguage,
  {
    invoice: string;
    billTo: string;
    engagement: string;
    issueDate: string;
    dueDate: string;
    description: string;
    qty: string;
    rate: string;
    amount: string;
    subtotal: string;
    total: string;
    terms: string;
    notes: string;
    regNumber: (n: string) => string;
    paid: string;
  }
> = {
  en: {
    invoice: "INVOICE",
    billTo: "Bill to",
    engagement: "Engagement",
    issueDate: "Issue date",
    dueDate: "Due date",
    description: "Description",
    qty: "Qty",
    rate: "Rate",
    amount: "Amount",
    subtotal: "Subtotal",
    total: "Total",
    terms: "Terms",
    notes: "Note",
    regNumber: (n) => `No. ${n}`,
    paid: "PAID",
  },
  fr: {
    invoice: "FACTURE",
    billTo: "Facturé à",
    engagement: "Dossier",
    issueDate: "Date d'émission",
    dueDate: "Échéance",
    description: "Description",
    qty: "Qté",
    rate: "Taux",
    amount: "Montant",
    subtotal: "Sous-total",
    total: "Total",
    terms: "Conditions",
    notes: "Note",
    regNumber: (n) => `No ${n}`,
    paid: "PAYÉE",
  },
};

// Money in the document: CAD, localized ("$1,234.56" / "1 234,56 $").
export function pdfMoney(cents: number, language: InvoicePdfLanguage): string {
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

// Dates print long-form in the invoice's language ("July 20, 2026" /
// "20 juillet 2026"). Input is the stored YYYY-MM-DD.
export function pdfDate(iso: string, language: InvoicePdfLanguage): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// "2" stays "2"; "2.5" prints localized ("2,5" in French).
export function pdfQuantity(q: number, language: InvoicePdfLanguage): string {
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    maximumFractionDigits: 3,
  }).format(q);
}

export function taxLineLabel(
  line: FrozenTaxLine,
  language: InvoicePdfLanguage,
): string {
  return taxComponentLabel(
    { id: line.component, rateMilliPct: line.rate_milli_pct },
    language,
  );
}

// Storage key for the frozen copy written at the paid flip. Under the firm
// prefix like every object, beside the attached-invoice folder.
export function generatedInvoicePdfPath(parts: {
  firmId: string;
  engagementId: string;
  paymentRequestId: string;
}): string {
  const safeId = safeStorageName(parts.paymentRequestId);
  return `firms/${parts.firmId}/engagements/${parts.engagementId}/invoices/generated-${safeId}.pdf`;
}

export function invoicePdfFilename(model: InvoicePdfModel): string {
  const base = model.invoiceNumber
    ? safeStorageName(model.invoiceNumber)
    : model.language === "fr"
      ? "facture"
      : "invoice";
  return `${base}.pdf`;
}

// Assemble the render model from the stored row + firm data. Only GENERATED
// invoices have a document; callers gate on invoice_kind before calling.
export function buildInvoicePdfModel(input: {
  request: PaymentRequest;
  firm: { name: string; brand_color: string | null };
  settings: Pick<FirmInvoiceSettings, "address" | "contact_line"> | null;
  clientName: string | null;
  engagementTitle: string | null;
  logoDataUri: string | null;
}): InvoicePdfModel {
  const r = input.request;
  const language: InvoicePdfLanguage = r.invoice_language === "en" ? "en" : "fr";
  const lines = parseStoredLineItems(r.line_items);
  const taxLines = parseStoredTaxLines(r.tax_breakdown);
  const brand = input.firm.brand_color ?? "";
  return {
    language,
    firmName: input.firm.name,
    firmAddressLines: (input.settings?.address ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
    firmContactLine: input.settings?.contact_line ?? null,
    brandColor: HEX_COLOR.test(brand) ? brand : FALLBACK_INK,
    logoDataUri: input.logoDataUri,
    clientName: input.clientName,
    engagementTitle: input.engagementTitle,
    invoiceNumber: r.invoice_number ?? null,
    issueDate: r.issue_date ?? r.created_at?.slice(0, 10) ?? null,
    dueDate: r.due_date ?? null,
    lines,
    taxLines,
    subtotalCents:
      r.subtotal_cents ?? lines.reduce((a, l) => a + l.amount_cents, 0),
    taxTotalCents:
      r.tax_total_cents ?? taxLines.reduce((a, l) => a + l.amount_cents, 0),
    totalCents: r.amount_cents,
    terms: r.invoice_terms ?? null,
    notes: r.invoice_notes ?? null,
    paid: r.status === "paid",
  };
}

// Sage 50 export — pure CSV building.
//
// Turns the SAME transaction extraction the QuickBooks path produces
// (ai_extracted_fields.transaction) into a clean, importable CSV. One row per
// exportable document. No GL account coding (v1): the firm codes in Sage. Pure +
// no imports beyond a type, so it is fully unit-tested; the route feeds it rows.

import type { TransactionExtraction } from "@/lib/ai/transaction-extract";

// One CSV row. Money fields stay numbers (or null) so the serializer formats
// them consistently; everything else is a plain string ("" when absent).
export type SageCsvRow = {
  date: string;
  direction: string;
  vendorOrPayee: string;
  description: string;
  subtotal: number | null;
  gstHst: number | null;
  qst: number | null;
  total: number | null;
  documentType: string;
  currency: string;
  client: string;
  engagement: string;
  link: string;
};

// Columns, in order. English + stable: Sage 50's import maps columns by hand, so
// the header language doesn't affect the import; keeping them fixed keeps the
// file deterministic. Direction is added to the founder's list because a receipt
// (money out) and a sales invoice (money in) post very differently in Sage.
export const SAGE_CSV_COLUMNS: { key: keyof SageCsvRow; header: string }[] = [
  { key: "date", header: "Date" },
  { key: "direction", header: "Direction" },
  { key: "vendorOrPayee", header: "Vendor/Payee" },
  { key: "description", header: "Description" },
  { key: "subtotal", header: "Subtotal" },
  { key: "gstHst", header: "GST/HST" },
  { key: "qst", header: "QST" },
  { key: "total", header: "Total" },
  { key: "documentType", header: "Document type" },
  { key: "currency", header: "Currency" },
  { key: "client", header: "Client" },
  { key: "engagement", header: "Engagement" },
  { key: "link", header: "Vylan link" },
];

// Split the extracted tax lines into the two columns a Quebec bookkeeper needs.
// GST/HST (federal): GST, HST, and the French TPS/TVH. QST (Quebec): QST / TVQ.
// PST (BC/SK/MB) and anything unrecognized are intentionally NOT folded into
// these two columns in v1 (Quebec focus); the Total still reflects the whole
// document. Returns null for a column with no matching line.
export function bucketTaxes(
  taxes: { type: string; amount: number }[],
): { gstHst: number | null; qst: number | null } {
  let gstHst: number | null = null;
  let qst: number | null = null;
  for (const tx of taxes) {
    const t = tx.type.toLowerCase();
    if (/qst|tvq/.test(t)) {
      qst = (qst ?? 0) + tx.amount;
    } else if (/gst|hst|tps|tvh/.test(t)) {
      gstHst = (gstHst ?? 0) + tx.amount;
    }
  }
  return { gstHst, qst };
}

// Map ONE extraction + its context into a CSV row. Vendor/Payee is the supplier
// for an expense and the customer for income. Description joins the line-item
// names (a compact memo); falls back to the extraction's note.
export function toSageCsvRow(
  txn: TransactionExtraction,
  ctx: {
    documentType: string;
    client: string;
    engagement: string;
    link: string;
  },
): SageCsvRow {
  const { gstHst, qst } = bucketTaxes(txn.taxes);
  const party =
    txn.direction === "income"
      ? txn.customer_name
      : (txn.vendor_name ?? txn.customer_name);
  const description =
    txn.line_items.length > 0
      ? txn.line_items
          .slice(0, 6)
          .map((li) => li.description)
          .join("; ")
      : (txn.notes ?? "");
  const direction =
    txn.direction === "expense"
      ? "Expense"
      : txn.direction === "income"
        ? "Income"
        : "";
  return {
    date: txn.document_date ?? "",
    direction,
    vendorOrPayee: party ?? "",
    description,
    subtotal: txn.subtotal,
    gstHst,
    qst,
    total: txn.total,
    documentType: ctx.documentType,
    currency: txn.currency ?? "",
    client: ctx.client,
    engagement: ctx.engagement,
    link: ctx.link,
  };
}

// RFC-4180 field: wrap in quotes, double any internal quotes. Everything is
// quoted so a comma, newline, or accent in a vendor name can never shift columns.
function csvField(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

// A money value as a plain 2-decimal string ("100.00"), or "" when absent. No
// currency symbol, no thousands separator — importers choke on "1,820.00".
function money(n: number | null): string {
  return n == null ? "" : n.toFixed(2);
}

// Serialize rows to a full CSV string. Prepends the UTF-8 BOM (﻿) so Excel
// and Sage on Windows render French accents (é, à, ç) correctly instead of
// mojibake. CRLF line endings, the CSV convention.
export function buildSageCsv(rows: SageCsvRow[]): string {
  const header = SAGE_CSV_COLUMNS.map((c) => csvField(c.header)).join(",");
  const body = rows.map((row) =>
    SAGE_CSV_COLUMNS.map((c) => {
      const v = row[c.key];
      const text =
        c.key === "subtotal" ||
        c.key === "gstHst" ||
        c.key === "qst" ||
        c.key === "total"
          ? money(v as number | null)
          : String(v ?? "");
      return csvField(text);
    }).join(","),
  );
  return "﻿" + [header, ...body].join("\r\n") + "\r\n";
}

// A readable, safe filename: vylan-sage50-{client}-{engagement}-{YYYY-MM-DD}.csv
// with names slugged (accents stripped, non-alphanumerics to hyphens, capped).
export function sageCsvFilename(
  client: string,
  engagement: string,
  dateISO: string,
): string {
  const slug = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 40) || "export";
  return `vylan-sage50-${slug(client)}-${slug(engagement)}-${dateISO.slice(0, 10)}.csv`;
}

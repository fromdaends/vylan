// Pure document-search logic for the engagement chat. The route fetches the
// engagement's uploaded_files rows once (they're bounded per engagement) and
// these helpers filter/compact them for the model — the chat's primary
// knowledge source is this structured data, never the raw documents.

import { CHAT_SEARCH_RESULT_CAP } from "./config";

// The subset of an uploaded_files row the chat reads. The jsonb shapes match
// what the classify worker writes (src/lib/ai/process.ts): ai_extracted_fields
// per ClassificationResult, ai_usability per UsabilityVerdict.
export type ChatFileRow = {
  id: string;
  request_item_id: string | null;
  display_name: string | null;
  original_filename: string | null;
  ai_classification: string | null;
  ai_confidence: number | null;
  review_status: "pending" | "approved" | "rejected" | null;
  rejection_reason: string | null;
  // null reviewed_by on a rejected file = the SYSTEM (AI/duplicate) rejected.
  reviewed_by: string | null;
  is_duplicate: boolean | null;
  uploaded_at: string;
  ai_extracted_fields: ExtractedFields | null;
  ai_usability: Usability | null;
};

type ExtractedFields = {
  extracted_year?: number | null;
  extracted_amount_or_total?: number | null;
  document_date?: string | null;
  issuer_name?: string | null;
  party_name?: string | null;
  account_or_period?: string | null;
  form_identifier?: string | null;
  key_identifiers?: string[] | null;
  amounts?: { label?: string | null; value?: number | null }[] | null;
  issue_if_any?: string | null;
  fields_confidence?: number | null;
  overall_confidence?: number | null;
  transaction?: {
    direction?: string | null;
    vendor_name?: string | null;
    customer_name?: string | null;
    document_date?: string | null;
    currency?: string | null;
    subtotal?: number | null;
    total?: number | null;
    taxes?: { type?: string | null; amount?: number | null }[] | null;
    line_items?: { description?: string | null; amount?: number | null }[] | null;
    paid?: boolean | null;
    payment_method?: string | null;
  } | null;
} | null;

type Usability = {
  usable?: boolean | null;
  primary_issue?: string | null;
  all_issues?: string[] | null;
  issue_summary_en?: string | null;
  issue_summary_fr?: string | null;
} | null;

export type SearchCriteria = {
  // Vendor / issuer / client-party name, matched accent- and case-
  // insensitively across every name-ish extracted field.
  vendor?: string;
  // Exact-to-the-cent by default; widen with amount_tolerance.
  amount?: number;
  amount_tolerance?: number;
  doc_type?: string;
  status?: "pending" | "approved" | "rejected";
  flagged_only?: boolean;
  year?: number;
  // Free-text across names, identifiers, and extracted labels.
  text?: string;
};

// Accent- and case-insensitive normalization (Québec French data).
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function nameHaystack(row: ChatFileRow): string {
  const f = row.ai_extracted_fields;
  const tx = f?.transaction;
  return normalizeText(
    [
      row.display_name,
      row.original_filename,
      f?.issuer_name,
      f?.party_name,
      tx?.vendor_name,
      tx?.customer_name,
      f?.form_identifier,
      f?.account_or_period,
      ...(f?.key_identifiers ?? []),
      ...(f?.amounts ?? []).map((a) => a?.label),
    ]
      .filter(Boolean)
      .join("  "),
  );
}

// Every dollar figure the document carries — the headline total, labelled
// boxes, and receipt/invoice subtotal, total, and line items — so "a Staples
// charge of $240" matches whether 240 was the total or one line of it.
export function amountCandidates(row: ChatFileRow): number[] {
  const f = row.ai_extracted_fields;
  const tx = f?.transaction;
  const out: number[] = [];
  const push = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  };
  push(f?.extracted_amount_or_total);
  for (const a of f?.amounts ?? []) push(a?.value);
  push(tx?.total);
  push(tx?.subtotal);
  for (const li of tx?.line_items ?? []) push(li?.amount);
  return out;
}

// "Flagged" = anything an accountant would want a second look at: an
// unusable verdict, a rejection (human or system), a noted concern, or a
// duplicate.
export function isFlagged(row: ChatFileRow): boolean {
  if (row.ai_usability?.usable === false) return true;
  if (row.review_status === "rejected") return true;
  if (row.is_duplicate === true) return true;
  const issue = row.ai_extracted_fields?.issue_if_any;
  return typeof issue === "string" && issue.trim().length > 0;
}

function yearOf(row: ChatFileRow): number[] {
  const f = row.ai_extracted_fields;
  const years: number[] = [];
  if (typeof f?.extracted_year === "number") years.push(f.extracted_year);
  for (const iso of [f?.document_date, f?.transaction?.document_date]) {
    const m = typeof iso === "string" ? /^(\d{4})/.exec(iso) : null;
    if (m) years.push(Number(m[1]));
  }
  return years;
}

export function fileMatches(
  row: ChatFileRow,
  criteria: SearchCriteria,
): boolean {
  if (criteria.status && row.review_status !== criteria.status) return false;
  if (criteria.flagged_only && !isFlagged(row)) return false;
  if (criteria.doc_type) {
    const want = normalizeText(criteria.doc_type).replace(/[\s_-]/g, "");
    const have = normalizeText(row.ai_classification ?? "").replace(
      /[\s_-]/g,
      "",
    );
    if (!have || have !== want) return false;
  }
  if (typeof criteria.year === "number") {
    if (!yearOf(row).includes(criteria.year)) return false;
  }
  if (criteria.vendor) {
    const needle = normalizeText(criteria.vendor);
    if (!needle || !nameHaystack(row).includes(needle)) return false;
  }
  if (typeof criteria.amount === "number") {
    const tolerance =
      typeof criteria.amount_tolerance === "number" &&
      criteria.amount_tolerance >= 0
        ? criteria.amount_tolerance
        : 0.01;
    const target = criteria.amount;
    const hit = amountCandidates(row).some(
      (v) => Math.abs(v - target) <= tolerance + 1e-9,
    );
    if (!hit) return false;
  }
  if (criteria.text) {
    const needle = normalizeText(criteria.text);
    if (!needle || !nameHaystack(row).includes(needle)) return false;
  }
  return true;
}

export type SearchOutcome = {
  total: number;
  returned: number;
  results: CompactFile[];
};

export function searchFiles(
  rows: ChatFileRow[],
  criteria: SearchCriteria,
  cap: number = CHAT_SEARCH_RESULT_CAP,
): SearchOutcome {
  const matches = rows
    .filter((r) => fileMatches(r, criteria))
    .sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));
  const results = matches.slice(0, cap).map(compactFile);
  return { total: matches.length, returned: results.length, results };
}

// The compact per-document shape returned to the model from a search — small
// on purpose (an engagement can hold dozens of documents).
export type CompactFile = {
  file_id: string;
  name: string;
  doc_type: string | null;
  review_status: string | null;
  uploaded_at: string;
  issuer: string | null;
  party: string | null;
  document_date: string | null;
  year: number | null;
  headline_amount: number | null;
  flagged: boolean;
  issue: string | null;
  is_duplicate: boolean;
};

export function compactFile(row: ChatFileRow): CompactFile {
  const f = row.ai_extracted_fields;
  return {
    file_id: row.id,
    name: row.display_name || row.original_filename || "(sans nom)",
    doc_type: row.ai_classification,
    review_status: row.review_status,
    uploaded_at: row.uploaded_at,
    issuer: f?.issuer_name ?? f?.transaction?.vendor_name ?? null,
    party: f?.party_name ?? null,
    document_date: f?.document_date ?? f?.transaction?.document_date ?? null,
    year: typeof f?.extracted_year === "number" ? f.extracted_year : null,
    headline_amount:
      typeof f?.extracted_amount_or_total === "number"
        ? f.extracted_amount_or_total
        : (f?.transaction?.total ?? null),
    flagged: isFlagged(row),
    issue:
      row.ai_usability?.primary_issue ??
      (typeof f?.issue_if_any === "string" && f.issue_if_any.trim()
        ? f.issue_if_any
        : null),
    is_duplicate: row.is_duplicate === true,
  };
}

// The fuller single-document shape for get_document_details.
export function compactFileDetails(row: ChatFileRow) {
  const f = row.ai_extracted_fields;
  const u = row.ai_usability;
  return {
    ...compactFile(row),
    rejection_reason: row.rejection_reason,
    rejected_by: row.review_status === "rejected"
      ? row.reviewed_by
        ? "accountant"
        : "system"
      : null,
    form_identifier: f?.form_identifier ?? null,
    account_or_period: f?.account_or_period ?? null,
    key_identifiers: f?.key_identifiers ?? [],
    amounts: (f?.amounts ?? [])
      .filter((a) => typeof a?.value === "number")
      .slice(0, 8),
    usability: u
      ? {
          usable: u.usable ?? null,
          primary_issue: u.primary_issue ?? null,
          all_issues: u.all_issues ?? [],
          summary_en: u.issue_summary_en ?? null,
          summary_fr: u.issue_summary_fr ?? null,
        }
      : null,
    transaction: f?.transaction
      ? {
          direction: f.transaction.direction ?? null,
          vendor: f.transaction.vendor_name ?? null,
          customer: f.transaction.customer_name ?? null,
          date: f.transaction.document_date ?? null,
          currency: f.transaction.currency ?? null,
          subtotal: f.transaction.subtotal ?? null,
          total: f.transaction.total ?? null,
          taxes: f.transaction.taxes ?? [],
          line_items: (f.transaction.line_items ?? []).slice(0, 40),
          paid: f.transaction.paid ?? null,
          payment_method: f.transaction.payment_method ?? null,
        }
      : null,
    confidence: {
      classification: row.ai_confidence,
      fields: f?.fields_confidence ?? null,
      overall: f?.overall_confidence ?? null,
    },
  };
}

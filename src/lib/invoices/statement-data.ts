// Assemble a client's statement of account from the database.
//
// The mirror of pdf-data.ts for invoices: this is the only place the statement
// touches Supabase, so statement-model.ts stays pure and the arithmetic stays
// testable without a database or a renderer anywhere near it.
//
// RLS-scoped throughout — a foreign client id resolves to nothing, and the
// route checks the firm on top of that.

import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getFirmInvoiceSettings } from "@/lib/db/invoice-settings";
import { downloadObject } from "@/lib/storage";
import {
  buildStatementLines,
  statementTotals,
  type StatementModel,
  type StatementInvoiceInput,
} from "./statement-model";
import { isoDay } from "./outstanding";

const FALLBACK_INK = "#0f172a";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function logoMime(path: string): string {
  return path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

export type StatementRange = { from: string | null; to: string | null };

// null = no such client for this firm (or no firm). The route turns that into
// a 404 rather than leaking whether the id exists elsewhere.
export async function assembleStatement(
  clientId: string,
  range: StatementRange,
  today: Date = new Date(),
): Promise<StatementModel | null> {
  const firm = await getCurrentFirm();
  if (!firm) return null;
  const sb = await getServerSupabase();

  const { data: client } = await sb
    .from("clients")
    .select("id, display_name, locale")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return null;

  // Tiered select: amount_paid_cents only exists after migration 1310. Without
  // it every unpaid invoice still reports its full amount as owing, which is
  // correct on a database that cannot record a partial payment.
  const baseCols =
    "id, amount_cents, status, due_date, issue_date, created_at, invoice_number, engagement_id";
  const withPaid = `${baseCols}, amount_paid_cents`;
  const run = async (cols: string) => {
    let q = sb.from("payment_requests").select(cols).eq("client_id", clientId);
    // The range applies to the invoice's own date, falling back to the row's
    // creation day for pre-0750 rows that have no issue_date.
    if (range.from) {
      q = q.or(
        `issue_date.gte.${range.from},and(issue_date.is.null,created_at.gte.${range.from}T00:00:00Z)`,
      );
    }
    if (range.to) {
      q = q.or(
        `issue_date.lte.${range.to},and(issue_date.is.null,created_at.lte.${range.to}T23:59:59Z)`,
      );
    }
    return q.order("created_at", { ascending: true });
  };

  let { data: rows, error } = await run(withPaid);
  if (error && (error.code === "PGRST204" || error.code === "42703")) {
    ({ data: rows, error } = await run(baseCols));
  }
  if (error) {
    console.error("[statement] invoice query failed:", error);
    return null;
  }

  const raw = (rows ?? []) as unknown as Array<Record<string, unknown>>;

  // Engagement titles in one batched query — a statement line reads better with
  // "T2 2025" beside the invoice number than with the number alone.
  const engIds = [
    ...new Set(raw.map((r) => r.engagement_id).filter(Boolean)),
  ] as string[];
  const engTitle = new Map<string, string>();
  if (engIds.length) {
    const { data } = await sb
      .from("engagements")
      .select("id, title")
      .in("id", engIds);
    for (const e of data ?? []) engTitle.set(e.id as string, e.title as string);
  }

  const invoices: StatementInvoiceInput[] = raw.map((r) => ({
    status: r.status as StatementInvoiceInput["status"],
    amount_cents: r.amount_cents as number,
    amount_paid_cents: (r.amount_paid_cents as number | undefined) ?? 0,
    due_date: (r.due_date as string | null) ?? null,
    invoice_number: (r.invoice_number as string | null) ?? null,
    issue_date: (r.issue_date as string | null) ?? null,
    created_at: String(r.created_at ?? ""),
    engagement_title: r.engagement_id
      ? (engTitle.get(r.engagement_id as string) ?? null)
      : null,
  }));

  const lines = buildStatementLines(invoices, today);
  const totals = statementTotals(lines);

  const settings = await getFirmInvoiceSettings();

  let logoDataUri: string | null = null;
  const logoPath = firm.logo_url as string | null;
  if (logoPath) {
    try {
      const bytes = await downloadObject(logoPath);
      logoDataUri = `data:${logoMime(logoPath)};base64,${bytes.toString("base64")}`;
    } catch {
      // Old URL-shaped values / missing objects → name-only header, exactly
      // like the invoice PDF does.
      logoDataUri = null;
    }
  }

  const brand = firm.brand_color as string | null;

  return {
    // The CLIENT's language, not the accountant's: this document is for them.
    language: client.locale === "en" ? "en" : "fr",
    firmName: firm.name,
    firmAddressLines: (settings?.address ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
    firmContactLine: settings?.contact_line?.trim() || null,
    brandColor: brand && HEX_COLOR.test(brand) ? brand : FALLBACK_INK,
    logoDataUri,
    clientName: client.display_name as string,
    from: range.from,
    to: range.to,
    generatedOn: isoDay(today),
    lines,
    ...totals,
  };
}

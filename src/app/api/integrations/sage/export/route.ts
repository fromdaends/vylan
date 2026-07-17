import { NextResponse } from "next/server";
import {
  getServerSupabase,
  getServiceRoleSupabase,
} from "@/lib/supabase/server";
import { getEngagement } from "@/lib/db/engagements";
import { downloadStorageObject } from "@/lib/ai/classify";
import {
  extractTransaction,
  type TransactionExtraction,
} from "@/lib/ai/transaction-extract";
import { getFirmAiUsage, incrementFirmAiUsage } from "@/lib/ai/usage";
import { isSageExportable } from "@/lib/integrations/sage-export";
import {
  buildSageCsv,
  toSageCsvRow,
  type SageCsvRow,
} from "@/lib/integrations/sage-csv";

// Sage 50 CSV export for one engagement. The ONLY paid step in the whole
// feature: it reads any receipts/invoices that haven't been read yet, ON DEMAND,
// only because someone clicked download — never on every upload. A read result
// is cached back onto the file (ai_extracted_fields.transaction), so a second
// export of the same engagement pays nothing. Reuses the QuickBooks extraction
// (extractTransaction); no parallel pipeline. RLS: the engagement is fetched
// through the authenticated client, so a firm can only ever export its own.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Bound the on-demand work so one export can't run for minutes or blow the AI
// budget. Typical engagements have a handful of receipts; this is the guard-rail
// for a pathological one. Anything read already (or read now) still exports.
const MAX_ONDEMAND_READS = 40;
const READ_CONCURRENCY = 4;

type FileRow = {
  id: string;
  storage_path: string;
  mime_type: string | null;
  display_name: string | null;
  original_filename: string | null;
  ai_classification: string | null;
  ai_extracted_fields: Record<string, unknown> | null;
  is_duplicate: boolean | null;
  ai_rejected: boolean | null;
  review_status: string | null;
  request_items:
    | { doc_type: string | null }
    | { doc_type: string | null }[]
    | null;
};

export async function POST(req: Request) {
  let engagementId = "";
  let locale = "en";
  try {
    const body = (await req.json()) as {
      engagementId?: string;
      locale?: string;
    };
    engagementId = String(body?.engagementId ?? "");
    locale = body?.locale === "fr" ? "fr" : "en";
  } catch {
    // fall through to the bad_request below
  }
  if (!engagementId) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Auth + firm scope in one: getEngagement reads through the authenticated
  // client, so it is null for an engagement this user/firm can't see.
  const supabase = await getServerSupabase();
  const engagement = await getEngagement(engagementId);
  if (!engagement) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: clientRow } = await supabase
    .from("clients")
    .select("display_name")
    .eq("id", engagement.client_id)
    .maybeSingle();
  const clientName = (clientRow?.display_name as string | null) ?? "";

  const { data: fileRows } = await supabase
    .from("uploaded_files")
    .select(
      "id, storage_path, mime_type, display_name, original_filename, ai_classification, ai_extracted_fields, is_duplicate, ai_rejected, review_status, request_items!inner(doc_type)",
    )
    .eq("engagement_id", engagementId)
    .order("uploaded_at", { ascending: false });

  const exportable = ((fileRows ?? []) as unknown as FileRow[])
    .filter(
      (r) => !r.is_duplicate && !r.ai_rejected && r.review_status !== "rejected",
    )
    .filter((r) => {
      const item = Array.isArray(r.request_items)
        ? r.request_items[0]
        : r.request_items;
      return isSageExportable(item?.doc_type ?? null, r.ai_classification);
    });

  // Already read vs needs reading.
  const readable: { row: FileRow; txn: TransactionExtraction }[] = [];
  const toRead: FileRow[] = [];
  for (const r of exportable) {
    const txn = r.ai_extracted_fields?.transaction as
      | TransactionExtraction
      | undefined;
    if (txn) readable.push({ row: r, txn });
    else toRead.push(r);
  }

  // On-demand read the un-read ones — unless the firm's AI budget is paused
  // (then we export only what's already read). Cache each result back, and count
  // it against the firm's usage exactly like the upload-time path does.
  const service = getServiceRoleSupabase();
  const usage = await getFirmAiUsage(engagement.firm_id);
  if (!usage.paused && toRead.length > 0) {
    const batch = toRead.slice(0, MAX_ONDEMAND_READS);
    let next = 0;
    const worker = async () => {
      while (next < batch.length) {
        const r = batch[next++];
        try {
          const dl = await downloadStorageObject(r.storage_path);
          if (!dl) continue;
          const txn = await extractTransaction({
            fileBytes: dl.bytes,
            mimeType: r.mime_type || dl.mimeType,
          });
          if (!txn) continue;
          readable.push({ row: r, txn });
          await service
            .from("uploaded_files")
            .update({
              ai_extracted_fields: {
                ...(r.ai_extracted_fields ?? {}),
                transaction: txn,
              },
            })
            .eq("id", r.id);
          await incrementFirmAiUsage(engagement.firm_id);
        } catch {
          // Best-effort per document: a single failed read just omits that row.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(READ_CONCURRENCY, batch.length) }, worker),
    );
  }

  if (readable.length === 0) {
    // The preview only enables the button when something is exportable, so this
    // means the reads all failed (unreadable images) or the budget is paused.
    return NextResponse.json({ error: "no_rows" }, { status: 422 });
  }

  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  const rows: SageCsvRow[] = readable
    // Chronological by document date (nulls last) for a tidy file.
    .sort((a, b) => (a.txn.document_date ?? "9999").localeCompare(b.txn.document_date ?? "9999"))
    .map(({ row, txn }) =>
      toSageCsvRow(txn, {
        documentType: row.ai_classification ?? "",
        client: clientName,
        engagement: engagement.title,
        link: appUrl ? `${appUrl}/${locale}/engagements/${engagementId}` : "",
      }),
    );

  const csv = buildSageCsv(rows);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      // So the client can honestly report "exported N of the previewed count".
      "X-Sage-Rows": String(rows.length),
    },
  });
}

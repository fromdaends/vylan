// Job worker for AI document classification.
//
// Payload: { uploaded_file_id: string }
// Reads the uploaded_files row, downloads the storage object, calls Claude,
// writes ai_classification / ai_confidence / ai_extracted_fields back, and
// logs an activity entry. Skips silently if the file is gone or the AI key
// is missing.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  checkRateLimit,
  AI_CLASSIFY_PER_FIRM_DAILY,
} from "@/lib/rate-limit";
import {
  classifyDocument,
  downloadStorageObject,
  isAiConfigured,
  type ClassificationResult,
} from "./classify";
import { shouldActOnUsability, wrongRecipientVerdict } from "./usability";
import { expectedYearFromTitle, matchDocument } from "./matching";
import type { DocType } from "@/lib/db/templates";
import { buildDisplayName } from "./display-name";
import { decide, applyDecision, type DispatcherResult } from "./router";
import { getFirmAiUsage, incrementFirmAiUsage } from "./usage";

export async function processClassifyJob(
  payload: Record<string, unknown>,
  // Optional pre-downloaded bytes from the upload route. When present we
  // skip the storage roundtrip (saves ~1-3s on large PDFs). The cron path
  // never passes this — it has to fetch.
  preDownloaded?: { bytes: Buffer; mimeType: string },
): Promise<{
  skipped?: string;
  classified?: ClassificationResult;
  routed?: DispatcherResult;
}> {
  if (!isAiConfigured()) return { skipped: "ai_not_configured" };
  const fileId = String(payload.uploaded_file_id ?? "");
  if (!fileId) return { skipped: "missing_file_id" };

  const sb = getServiceRoleSupabase();
  const { data: file } = await sb
    .from("uploaded_files")
    .select(
      "id, request_item_id, engagement_id, storage_path, mime_type, original_filename, request_items!inner(doc_type, engagement_id, label, label_fr)",
    )
    .eq("id", fileId)
    .maybeSingle();
  if (!file) return { skipped: "file_not_found" };

  type ItemRow = {
    doc_type: string;
    engagement_id: string;
    label: string | null;
    label_fr: string | null;
  };
  type Row = { request_items: ItemRow | ItemRow[] | null };
  const itemRaw = (file as unknown as Row).request_items;
  const item = Array.isArray(itemRaw) ? itemRaw[0] : itemRaw;
  const expectedDocType = item?.doc_type as string | undefined;
  if (!expectedDocType) return { skipped: "no_expected_doc_type" };

  // Cap AI spend per firm per day. We look up firm_id from the engagement
  // before downloading the file so an attacker can't burn bandwidth on
  // download either. If the firm is over its daily quota, defer the work
  // (skipped) — the next day's cron run can pick it up if still needed.
  const { data: engagementForLimit } = await sb
    .from("engagements")
    .select("firm_id, title, clients!inner(display_name)")
    .eq("id", file.engagement_id)
    .single();
  const limitFirmId: string | null = engagementForLimit?.firm_id ?? null;
  // Request context for the classifier: the item's human label plus the
  // engagement's client + tax year, so the model can judge "is this even the
  // requested document" (drives the wrong_document_type auto-bounce). Year
  // read off the title with the SAME helper the accountant UI's match panel
  // uses, so the two judgments share their inputs.
  type EngagementCtx = {
    title?: string | null;
    clients?: { display_name?: string | null } | { display_name?: string | null }[];
  };
  const engCtx = engagementForLimit as unknown as EngagementCtx | null;
  const ctxClient = Array.isArray(engCtx?.clients)
    ? engCtx?.clients[0]
    : engCtx?.clients;
  const requestContext = {
    requestLabel: item?.label ?? null,
    requestLabelFr: item?.label_fr ?? null,
    clientName: ctxClient?.display_name ?? null,
    expectedYear: expectedYearFromTitle(engCtx?.title ?? ""),
  };
  if (limitFirmId) {
    const rl = await checkRateLimit({
      key: `ai:classify:firm:${limitFirmId}`,
      ...AI_CLASSIFY_PER_FIRM_DAILY,
    });
    if (!rl.ok) return { skipped: "firm_daily_quota_exceeded" };

    // Per-firm MONTHLY cap (migration 0230): once a firm hits ai_monthly_cap
    // client-document AI checks this calendar month, auto-pause the AI for the
    // rest of the month to bound token spend. The upload already succeeded —
    // we just skip the (paid) classification. Resets next month.
    const usage = await getFirmAiUsage(limitFirmId);
    if (usage.paused) return { skipped: "firm_monthly_cap_exceeded" };
  }

  let bytes: Buffer;
  let mimeType: string;
  if (preDownloaded) {
    bytes = preDownloaded.bytes;
    // Prefer the MIME validated + stored at upload (uploaded_files.mime_type)
    // over a download/header-derived one. The storage CDN sometimes returns
    // application/octet-stream for PDFs, which made the classifier treat them
    // as an unsupported format and skip the AI check entirely.
    mimeType = file.mime_type || preDownloaded.mimeType;
  } else {
    const dl = await downloadStorageObject(file.storage_path);
    if (!dl) return { skipped: "download_failed" };
    bytes = dl.bytes;
    mimeType = file.mime_type || dl.mimeType;
  }

  const result = await classifyDocument({
    expectedDocType: expectedDocType as never,
    fileBytes: bytes,
    mimeType,
    request: requestContext,
  });
  if (!result) return { skipped: "no_classification" };

  // FOUNDER RULE — a wrong-PERSON document is never acceptable, however clean
  // the scan. Re-use the SAME deterministic matcher the accountant's Preview +
  // checklist use (matchDocument's identity check: the named party shares NO
  // name token with the client, AI reasonably sure >= 0.5), so this can never
  // disagree with what the Preview shows. On a stranger name we fold the verdict
  // into usable=false so the EXISTING reject/notify router (below) auto-rejects
  // and messages the client — and every status surface stays consistent. Year /
  // type mismatches stay SOFT flags (surfaced, not bounced); only a wrong NAME
  // forces the re-send.
  const identityMismatch = matchDocument({
    expectedDocType: expectedDocType as DocType,
    expectedYear: requestContext.expectedYear,
    clientName: requestContext.clientName,
    classification: {
      document_type: result.document_type as DocType | "unknown",
      confidence: result.confidence,
      extracted_year: result.extracted_year,
      party_name: result.party_name,
      fields_confidence: result.fields_confidence,
    },
  }).find((f) => f.kind === "identity_mismatch");

  const usability = identityMismatch
    ? wrongRecipientVerdict(
        result.usability,
        identityMismatch.expected, // the client's name
        identityMismatch.actual, // the name read off the document
        identityMismatch.confidence,
      )
    : result.usability;

  // ai_rejected is intentionally NOT set here. Phase 3's routing logic
  // decides whether the system actually auto-rejects this upload based
  // on the firm's auto_reject_unusable_docs flag + the strike counter.
  await sb
    .from("uploaded_files")
    .update({
      ai_classification: result.document_type,
      ai_confidence: result.confidence,
      ai_extracted_fields: {
        extracted_year: result.extracted_year,
        extracted_amount_or_total: result.extracted_amount_or_total,
        looks_correct: result.looks_correct,
        issue_if_any: result.issue_if_any,
        // Phase 2: classification transparency — why, the identifying text
        // read, and an honest runner-up when the type was ambiguous.
        reasoning: result.reasoning,
        key_identifiers: result.key_identifiers,
        second_guess: result.second_guess,
        // Phase 3: key fields read off the document (power Phase 4 matching).
        document_date: result.document_date,
        issuer_name: result.issuer_name,
        party_name: result.party_name,
        account_or_period: result.account_or_period,
        form_identifier: result.form_identifier,
        amounts: result.amounts,
        fields_confidence: result.fields_confidence,
      },
      ai_usability: usability,
    })
    .eq("id", file.id);

  // Auto-name (migration 0280): give the file a clean, human name (e.g.
  // "T4 - 2024 - Hydro-Quebec.pdf") so the accountant isn't staring at
  // "IMG_2931.pdf". EVERY classified file gets one — wrong or unidentifiable
  // documents fall back to a generic "Document - …" built from whatever
  // fields were read. Recomputed on every (re)classification so it tracks
  // the latest verdict. English short label (slip codes like T4/RL-1 are
  // identical FR/EN; only a few descriptive types differ) keeps the stored
  // name deterministic without an extra locale lookup.
  //
  // Deliberately a SEPARATE, best-effort write: if the display_name column
  // isn't there yet (0280 not applied to this environment), the core
  // classification above still lands — auto-naming just stays off until the
  // column exists. So the feature is safe to ship before/after the migration.
  const displayName = buildDisplayName(
    {
      documentType: result.document_type,
      confidence: result.confidence,
      extractedYear: result.extracted_year,
      issuerName: result.issuer_name,
      partyName: result.party_name,
    },
    file.original_filename,
  );
  try {
    const { error: nameErr } = await sb
      .from("uploaded_files")
      .update({ display_name: displayName })
      .eq("id", file.id);
    if (nameErr) {
      console.warn("[classify] display_name not written (migration 0280?):", nameErr.message);
    }
  } catch (err) {
    console.warn("[classify] display_name update threw:", err);
  }

  // A real AI check ran — count it against the firm's monthly cap (best-effort,
  // never blocks). Drives the auto-pause once the firm reaches ai_monthly_cap.
  if (limitFirmId) await incrementFirmAiUsage(limitFirmId);

  // Pull the firm + client locale together so we can both log the
  // classification AND decide whether to route the AI's verdict.
  const { data: e } = await sb
    .from("engagements")
    .select("firm_id, clients!inner(locale)")
    .eq("id", file.engagement_id)
    .single();
  type EngagementRow = {
    firm_id: string;
    clients: { locale: "fr" | "en" } | { locale: "fr" | "en" }[];
  };
  const eRow = e as unknown as EngagementRow | null;
  const firmId = eRow?.firm_id ?? null;
  const clientLocale = Array.isArray(eRow?.clients)
    ? eRow?.clients[0]?.locale
    : eRow?.clients?.locale;

  if (firmId) {
    await sb.from("activity_log").insert({
      firm_id: firmId,
      engagement_id: file.engagement_id,
      actor_type: "system",
      action: "ai_classified",
      metadata: {
        uploaded_file_id: file.id,
        document_type: result.document_type,
        confidence: result.confidence,
        looks_correct: result.looks_correct,
        usable: usability.usable,
        usability_confidence: usability.confidence,
        primary_issue: usability.primary_issue,
      },
    });
  }

  // Route the verdict if (and only if) the AI is confidently unusable.
  // The router consults the firm flag + strike counter to decide
  // between auto-reject, escalate, and queue.
  let routed: DispatcherResult | undefined;
  if (firmId && shouldActOnUsability(usability)) {
    const [firmRow, itemRow] = await Promise.all([
      sb
        .from("firms")
        .select("auto_reject_unusable_docs")
        .eq("id", firmId)
        .single(),
      sb
        .from("request_items")
        .select("ai_rejection_count")
        .eq("id", file.request_item_id)
        .single(),
    ]);
    const autoRejectOn = Boolean(
      firmRow.data?.auto_reject_unusable_docs,
    );
    const rejectionCount = Number(
      itemRow.data?.ai_rejection_count ?? 0,
    );
    const decision = decide({ autoRejectOn, rejectionCount });
    routed = await applyDecision({
      supabase: sb,
      decision,
      verdict: usability,
      fileId: file.id,
      requestItemId: file.request_item_id,
      engagementId: file.engagement_id,
      firmId,
      clientLocale: clientLocale === "en" ? "en" : "fr",
    });
  }

  return { classified: result, routed };
}

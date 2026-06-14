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
import { shouldActOnUsability } from "./usability";
import { expectedYearFromTitle } from "./matching";
import { buildDisplayName } from "./display-name";
import { decide, applyDecision, type DispatcherResult } from "./router";
import { getFirmAiUsage, incrementFirmAiUsage } from "./usage";
import { isEngagementAiEnabled } from "./engagement-ai";

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

  // Per-engagement "AI Analyze" toggle (migration 0340): the accountant turned
  // AI off for this engagement, so skip the (paid) classification entirely —
  // before any storage download or model call. Checked here, at the engine, so
  // NO upload path can spend tokens on a disabled engagement. Fail-open: a
  // missing column or a read error reads as ON (see isEngagementAiEnabled). The
  // skip is terminal-done in the cron (not in RETRYABLE_SKIPS), so it never
  // loops.
  if (!(await isEngagementAiEnabled(sb, file.engagement_id))) {
    return { skipped: "engagement_ai_disabled" };
  }

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
  // Can't resolve the firm → can't enforce the monthly OR trial AI cap. Fail
  // CLOSED rather than spend uncapped AI. Retryable (see RETRYABLE_SKIPS): a
  // transient engagement-read miss recovers on the cron's next attempt; a truly
  // orphaned file gives up after MAX_ATTEMPTS.
  if (!limitFirmId) return { skipped: "firm_not_resolved" };
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
    if (usage.paused) {
      // Trial firms hit a low LIFETIME cap (abuse/cost guard); paid firms hit
      // the monthly cap. Distinct codes so logs + the portal can tell them
      // apart. Both are terminal-done in the cron (not in RETRYABLE_SKIPS).
      return {
        skipped: usage.isTrial
          ? "trial_ai_limit_reached"
          : "firm_monthly_cap_exceeded",
      };
    }
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
        // Holistic identity judgment + honest headline score (drive the
        // checklist/Preview "wrong person" flag and the prominent % meter).
        belongs_to_client: result.belongs_to_client,
        belongs_confidence: result.belongs_confidence,
        overall_confidence: result.overall_confidence,
      },
      ai_usability: result.usability,
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
        usable: result.usability.usable,
        usability_confidence: result.usability.confidence,
        primary_issue: result.usability.primary_issue,
      },
    });
  }

  // Route the verdict if (and only if) the AI is confidently unusable.
  // The router consults the firm flag + strike counter to decide
  // between auto-reject, escalate, and queue.
  let routed: DispatcherResult | undefined;
  if (firmId && shouldActOnUsability(result.usability)) {
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
      verdict: result.usability,
      fileId: file.id,
      requestItemId: file.request_item_id,
      engagementId: file.engagement_id,
      firmId,
      clientLocale: clientLocale === "en" ? "en" : "fr",
    });
  }

  return { classified: result, routed };
}

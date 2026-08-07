// Sending the firm's engagement letter, automatically (migration 1580).
//
// This is what the `send_engagement_letter` entry action does now, in place of
// chunk 1's honest `skipped (not_configured)`. It reuses the EXISTING e-sign
// mechanism end to end — the same SignWell client, the same request_items row
// with kind='signature', the same signature_requests table, the same portal
// signing surface, the same webhook completing it. Nothing about signing is
// re-implemented here; only the "who decided to send it" changes.
//
// TWO THINGS THE MANUAL PATH HAS THAT THIS CANNOT:
//
//  1. A person picking the file — replaced by the firm's stored letter, chosen
//     by the client's language.
//  2. A person dragging the signature field — replaced by SignWell's DEFAULT
//     mode (with_signature_page: true), which appends a clean signature page
//     carrying the field and sends immediately. That mode exists precisely for
//     documents nobody is standing over; the embedded editor stays the manual
//     path for one-off documents that need a field on a specific page.
//
// SERVICE ROLE: this runs inside the stage engine, which fires from webhooks
// and portal events with no accountant session. Every id comes from trusted
// server state, never client input.
//
// NEVER THROWS. Every failure is a typed reason the caller records on the
// workflow ledger, so a firm can see "the letter didn't go, and why" on the
// engagement rather than discovering the silence weeks later.

import { nanoid } from "nanoid";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import { getLetterForServiceSR } from "@/lib/db/engagement-letters";
import { addSignatureItemToEngagement } from "@/lib/db/request-items";
import { createSignatureRequest } from "@/lib/db/signature-requests";
import { logServiceRoleActivity } from "@/lib/db/activity";
import {
  downloadObject,
  signingDocPath,
  uploadObject,
  getBrandingImageUrlForEmail,
} from "@/lib/storage";
import {
  createSignatureDocument,
  isSignwellConfigured,
  isSignwellEmbeddedEditingEnabled,
  isSignwellTestMode,
} from "@/lib/signwell/client";
import { buildSignatureRequestEmail, sendEmail } from "@/lib/email";
import { engagementLetterKey } from "./letter-key";

export type LetterSendOutcome =
  | {
      ok: true;
      itemId: string;
      documentId: string | null;
      letterKey: string | null;
      /** Present only in editor mode: the one-shot SignWell field-placement
       *  URL (it expires once opened — never store it; getDocument re-reads
       *  a fresh one for the resume path). */
      editUrl?: string | null;
    }
  | {
      ok: false;
      reason:
        // No service on the engagement to take a letter from. Since 1700 the
        // letter belongs to a service, so an engagement with no priced line
        // has no letter to send — stated plainly rather than guessed at.
        | "no_service"
        // The service has no letter uploaded — the ordinary "not set up yet".
        | "not_configured"
        // This client already signed one covering the same service + year.
        | "already_signed"
        // This engagement already has its letter (a replayed effect).
        | "already_sent"
        | "no_signer_email"
        | "signwell_not_configured"
        | "engagement_missing"
        | "failed";
      detail?: string;
    };

type EngagementRow = {
  id: string;
  firm_id: string;
  client_id: string;
  title: string;
  type: string | null;
  tax_year: number | null;
  created_at: string;
  magic_token: string | null;
};

// The label the letter's checklist item carries, in both languages. Fixed
// copy rather than a firm-editable string: it names a legal document every
// firm sends, and a per-firm label is a setting nobody would ever change.
const LABEL_EN = "Engagement letter";
const LABEL_FR = "Lettre de mission";

export async function sendEngagementLetter(input: {
  engagementId: string;
  firmId: string;
  /** An accountant is PRESENT (create-and-send / the Send button) and asked
   *  to place the signature fields themselves: SignWell draft + embedded
   *  editor, with the client email deferred until placement finalizes
   *  (finalizeSignaturePlacementAction) — the manual dialog's exact rhythm.
   *  Never set on unattended paths (recurring spawns), where the appended
   *  signature page is what makes the send legal. */
  embeddedEdit?: boolean;
}): Promise<LetterSendOutcome> {
  const sb = getServiceRoleSupabase();

  // ── The engagement, and what its letter would cover ───────────────────────
  let eng: EngagementRow | null = null;
  {
    const { data } = await sb
      .from("engagements")
      .select(
        "id, firm_id, client_id, title, type, tax_year, created_at, magic_token",
      )
      .eq("id", input.engagementId)
      .maybeSingle();
    eng = (data as EngagementRow) ?? null;
  }
  if (!eng) return { ok: false, reason: "engagement_missing" };

  // ── Which service's letter? ───────────────────────────────────────────────
  // The engagement's priced lines carry service_id as provenance (1450/1487).
  // Reading it through is correct HERE and nowhere else: the rule that a line
  // must never read its PRICE through the FK protects an agreement the client
  // already made, and this is the opposite moment — we are about to ask them
  // to agree, so the CURRENT letter is the right one. Once sent, the PDF is
  // copied onto the engagement and frozen.
  //
  // In proposal order, first line wins: that is the headline service, the
  // same rule the engagements list uses when it truncates to "+2 more".
  const serviceId = await resolveServiceId(sb, eng.id);
  if (!serviceId) return { ok: false, reason: "no_service" };

  const letterKey = engagementLetterKey({
    serviceId,
    taxYear: eng.tax_year,
    createdAt: eng.created_at,
  });

  // ── The client (signer + language) ────────────────────────────────────────
  const { data: clientRow } = await sb
    .from("clients")
    .select("display_name, email, locale")
    .eq("id", eng.client_id)
    .maybeSingle();
  const client = clientRow as {
    display_name: string;
    email: string | null;
    locale: string | null;
  } | null;
  const locale: "en" | "fr" = client?.locale === "en" ? "en" : "fr";

  // ── The duplicate guard ───────────────────────────────────────────────────
  // Ask about the CLIENT, not the engagement: the spec's own example is a
  // letter signed during onboarding, which is a different engagement
  // entirely. A completed letter with the same key anywhere on this client's
  // work means they have already agreed to this scope for this year.
  if (letterKey) {
    const guard = await findExistingLetter(sb, {
      clientId: eng.client_id,
      firmId: eng.firm_id,
      letterKey,
      engagementId: eng.id,
    });
    if (guard) return { ok: false, reason: guard };
  }

  // ── The service's letter ──────────────────────────────────────────────────
  const letter = await getLetterForServiceSR(serviceId, locale);
  if (!letter) return { ok: false, reason: "not_configured" };

  if (!isSignwellConfigured()) {
    return { ok: false, reason: "signwell_not_configured" };
  }
  if (!client?.email) return { ok: false, reason: "no_signer_email" };

  // ── Copy the firm's letter onto this engagement ───────────────────────────
  // A per-engagement COPY, not a pointer at the firm's file: the signed
  // document has to stay exactly what this client agreed to, even after the
  // firm replaces its letter next year. Same copy-on-use rule as everything
  // else in this feature.
  let fileBase64: string;
  let engagementCopyPath: string;
  try {
    const bytes = await downloadObject(letter.storagePath);
    fileBase64 = bytes.toString("base64");
    engagementCopyPath = signingDocPath({
      firmId: eng.firm_id,
      engagementId: eng.id,
      uuid: nanoid(12),
      filename: letter.fileName,
    });
    await uploadObject({
      path: engagementCopyPath,
      body: bytes,
      contentType: "application/pdf",
    });
  } catch (e) {
    console.error("[workflow-letter] copying the letter failed:", e);
    return { ok: false, reason: "failed", detail: "storage" };
  }

  // ── The checklist item the client sees ────────────────────────────────────
  let itemId: string;
  try {
    const item = await addSignatureItemToEngagement({
      engagement_id: eng.id,
      label: LABEL_EN,
      label_fr: LABEL_FR,
      signing_doc_path: engagementCopyPath,
      signing_doc_name: letter.fileName,
      signing_doc_mime: "application/pdf",
      sb,
    });
    itemId = item.id;
  } catch (e) {
    console.error("[workflow-letter] creating the signature item failed:", e);
    return { ok: false, reason: "failed", detail: "item" };
  }

  // ── The SignWell request ──────────────────────────────────────────────────
  const testMode = isSignwellTestMode();
  let documentId: string | null = null;
  let status: "sent" | "pending" | "error" = "sent";
  let editUrl: string | null = null;
  let errorDetail: string | null = null;
  try {
    const doc = await createSignatureDocument({
      name: `${LABEL_EN} — ${eng.title}`,
      fileBase64,
      fileName: letter.fileName,
      signerEmail: client.email,
      signerName: client.display_name,
      // embeddedEdit only when an accountant asked to place the fields and
      // is present to do it; otherwise the appended signature page is what
      // makes an unattended send legal. The client silently falls back to
      // the default mode when the editor app id isn't configured — status
      // keys off the URL actually coming back, not off what was asked.
      embeddedEdit: input.embeddedEdit === true,
      metadata: {
        request_item_id: itemId,
        engagement_id: eng.id,
        source: "workflow_letter",
      },
    });
    documentId = doc.documentId;
    if (input.embeddedEdit === true && isSignwellEmbeddedEditingEnabled()) {
      if (doc.embeddedEditUrl) {
        editUrl = doc.embeddedEditUrl;
        // A draft awaiting placement — the same status the manual dialog's
        // editor mode uses; finalizeSignaturePlacementAction sends it.
        status = "pending";
      } else {
        // The wrapper made a DRAFT (editor requested + app id present) but
        // SignWell returned no edit URL — the manual path's 'no_edit_url'
        // case. Calling this 'sent' would email the client an unsendable
        // draft wearing a healthy status; it is a setup error, retryable
        // via the existing retry affordance.
        status = "error";
        errorDetail = "no_edit_url";
      }
    }
  } catch (e) {
    // The item exists and shows "Signing setup needed" with a Retry, exactly
    // as a failed manual send does — the accountant is never left guessing.
    status = "error";
    errorDetail = (e as Error).message.slice(0, 400);
    console.error("[workflow-letter] SignWell create failed:", e);
  }

  const created = await createSignatureRequestWithKey(sb, {
    firm_id: eng.firm_id,
    engagement_id: eng.id,
    request_item_id: itemId,
    signwell_document_id: documentId,
    status,
    test_mode: testMode,
    signer_email: client.email,
    signer_name: client.display_name,
    error_detail: errorDetail,
    letter_key: letterKey,
  });
  if (!created) {
    return { ok: false, reason: "failed", detail: "signature_request" };
  }

  // Pending drafts defer the audit to placement finalize (announceSignature-
  // Request logs it then) — the manual dialog's rule, and without it every
  // editor-mode letter logged 'signature_requested' twice, the first stamp
  // dated before anything had gone out.
  if (status !== "pending") {
    await logServiceRoleActivity(eng.firm_id, eng.id, "signature_requested", {
      item_id: itemId,
      label: LABEL_FR,
      test_mode: testMode,
      auto: true,
      source: "engagement_letter",
      ...(letterKey ? { letter_key: letterKey } : {}),
      ...(documentId ? { signwell_document_id: documentId } : {}),
    });
  }

  // Pending (editor mode) defers the email to placement finalize, exactly
  // like the manual dialog — a client must never be invited to sign a draft
  // whose fields aren't placed yet.
  if (status === "sent") {
    await notifyClient(eng, client, locale).catch((e) =>
      console.error("[workflow-letter] client email failed:", e),
    );
  }

  return { ok: true, itemId, documentId, letterKey, editUrl };
}

// The engagement's headline service: the first priced line, in proposal
// order, that came from the catalogue. Lines typed by hand carry no
// service_id and are skipped — they have no letter to offer.
async function resolveServiceId(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  engagementId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("engagement_items")
    .select("service_id, order_index")
    .eq("engagement_id", engagementId)
    .order("order_index", { ascending: true });
  if (error) {
    // Pre-1450 (no engagement_items) reads as "no service", which is the
    // truth for that environment.
    return null;
  }
  const rows = (data ?? []) as { service_id: string | null }[];
  return rows.find((r) => r.service_id)?.service_id ?? null;
}

// Has this letter already been asked for? Two different "yes"es:
//   already_signed — the client COMPLETED one covering the same key, on any
//                    of their engagements (the spec's guard).
//   already_sent   — this engagement already has one out or done (a replay).
async function findExistingLetter(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  q: {
    clientId: string;
    firmId: string;
    letterKey: string;
    engagementId: string;
  },
): Promise<"already_signed" | "already_sent" | null> {
  // The client's engagements — the scope of "this client already signed one".
  const { data: engRows, error: engErr } = await sb
    .from("engagements")
    .select("id")
    .eq("client_id", q.clientId);
  if (engErr) {
    // Can't prove a duplicate: send. A second signature request is a nuisance;
    // a silently missing engagement letter is a firm working without one.
    console.error("[workflow-letter] guard lookup failed:", engErr);
    return null;
  }
  const ids = ((engRows ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return null;

  const { data, error } = await sb
    .from("signature_requests")
    .select("engagement_id, status")
    .eq("letter_key", q.letterKey)
    .in("engagement_id", ids);
  if (error) {
    // Pre-1580 (no letter_key column) reads as "no duplicates known".
    return null;
  }
  const rows = (data ?? []) as { engagement_id: string; status: string }[];
  if (rows.some((r) => r.status === "completed")) return "already_signed";
  // Anything still live on THIS engagement means the effect already ran.
  if (
    rows.some(
      (r) =>
        r.engagement_id === q.engagementId &&
        r.status !== "error" &&
        r.status !== "canceled",
    )
  ) {
    return "already_sent";
  }
  return null;
}

// createSignatureRequest (the shared writer) is session-scoped and has no
// letter_key. Rather than widen that signature for one caller, the automated
// path writes its own row through the service role — and retries WITHOUT
// letter_key if 1580 hasn't been applied, so the letter still sends (it just
// can't be deduped yet, which is the safe direction).
async function createSignatureRequestWithKey(
  sb: ReturnType<typeof getServiceRoleSupabase>,
  row: Parameters<typeof createSignatureRequest>[0] & {
    letter_key: string | null;
  },
): Promise<boolean> {
  const { letter_key, ...base } = row;
  const { error } = await sb
    .from("signature_requests")
    .insert({ ...base, letter_key });
  if (!error) return true;
  if (error.code === "PGRST204" || error.code === "42703") {
    const { error: retryErr } = await sb
      .from("signature_requests")
      .insert(base);
    if (!retryErr) return true;
    console.error("[workflow-letter] signature request insert failed:", retryErr);
    return false;
  }
  console.error("[workflow-letter] signature request insert failed:", error);
  return false;
}

// The same branded email the manual path sends, in the client's language.
async function notifyClient(
  eng: EngagementRow,
  client: { display_name: string; email: string | null },
  locale: "en" | "fr",
): Promise<void> {
  if (!client.email || !eng.magic_token) return;
  const sb = getServiceRoleSupabase();
  const { data: firmRow } = await sb
    .from("firms")
    .select("name, logo_url")
    .eq("id", eng.firm_id)
    .maybeSingle();
  const firm = firmRow as { name: string; logo_url: string | null } | null;
  if (!firm) return;

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const { subject, html, text } = buildSignatureRequestEmail({
    clientName: client.display_name,
    firmName: firm.name,
    firmLogoUrl: await getBrandingImageUrlForEmail(firm.logo_url),
    documentName: locale === "en" ? LABEL_EN : LABEL_FR,
    url: `${appUrl}/r/${eng.magic_token}`,
    locale,
  });
  await sendEmail({ to: client.email, subject, html, text });
}

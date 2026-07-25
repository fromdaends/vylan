"use server";

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { addSignatureItemToEngagement } from "@/lib/db/request-items";
import { logUserActivity } from "@/lib/db/activity";
import { getClient } from "@/lib/db/clients";
import { getCurrentFirm } from "@/lib/db/firms";
import {
  MAX_BYTES,
  signingDocPath,
  uploadObject,
  downloadObject,
  truncateFilename,
  getBrandingImageUrlForEmail,
} from "@/lib/storage";
import {
  createSignatureDocument,
  sendDocument,
  getDocument,
  isSignwellConfigured,
  isSignwellEmbeddedEditingEnabled,
  isSignwellTestMode,
  SignwellError,
  type SignatureStatus,
} from "@/lib/signwell/client";
import {
  createSignatureRequest,
  getSignatureRequestByItem,
  updateSignatureRequestStatus,
  updateSignatureRequestSetup,
} from "@/lib/db/signature-requests";
import { syncEngagementStage } from "@/lib/engagements/stage-sync";
import { sendEmail, buildSignatureRequestEmail } from "@/lib/email";
import type { ItemActionState } from "@/app/actions/items";

// The add-signature action can return an embedded field-placement editor URL (in
// "place anywhere" mode) so the dialog can open SignWell's editor right after the
// upload. A superset of ItemActionState so the existing dialog wiring still fits.
export type SignatureActionState =
  | (NonNullable<ItemActionState> & {
      // Set when the accountant should place the signature field(s) in the
      // embedded editor before the request goes out. The dialog opens this URL,
      // then calls finalizeSignaturePlacementAction(itemId) on completion.
      editUrl?: string;
      itemId?: string;
    })
  | null;

// Accountant creates a SIGNATURE item: they name it (FR + EN) and upload the PDF
// the client needs to sign. We store that document, create the item
// (kind='signature'), then create an EMBEDDED SignWell signature request (test
// mode while building) and record it in signature_requests. The client signs the
// document inside the Vylan portal (Phase 3); the signed copy + audit trail flow
// back via the SignWell webhook (Phase 4).
export async function addSignatureItemAction(
  _prev: SignatureActionState,
  formData: FormData,
): Promise<SignatureActionState> {
  const engagementId = formData.get("engagement_id");
  const labelFr = formData.get("label_fr");
  const labelEn = formData.get("label_en");
  const file = formData.get("file");

  if (
    typeof engagementId !== "string" ||
    !engagementId ||
    typeof labelFr !== "string" ||
    !labelFr.trim() ||
    typeof labelEn !== "string" ||
    !labelEn.trim()
  ) {
    return { error: "generic" };
  }
  if (!(file instanceof File) || file.size === 0) return { error: "file" };
  if (file.size > MAX_BYTES) return { error: "file" };
  // SignWell signs PDFs. The document to be signed must be a PDF.
  if (file.type !== "application/pdf") return { error: "file" };

  // The session client is RLS-scoped, so the accountant can only resolve their
  // own firm's engagement — creating a signature item here is firm-isolated.
  const sb = await getServerSupabase();
  const { data: eng } = await sb
    .from("engagements")
    .select("id, firm_id, client_id, magic_token")
    .eq("id", engagementId)
    .maybeSingle();
  if (!eng) return { error: "generic" };

  // Store the document to be signed, and keep the bytes to send to SignWell
  // (base64) without re-reading from storage.
  const safeName = truncateFilename(file.name);
  const uuid = nanoid(12);
  const path = signingDocPath({
    firmId: eng.firm_id as string,
    engagementId,
    uuid,
    filename: safeName,
  });
  let fileBase64: string;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    fileBase64 = bytes.toString("base64");
    await uploadObject({
      path,
      body: bytes,
      contentType: file.type || "application/pdf",
    });
  } catch {
    return { error: "generic" };
  }

  // Create the signature item pointing at that document.
  let itemId: string;
  try {
    const item = await addSignatureItemToEngagement({
      engagement_id: engagementId,
      label: labelEn.trim(),
      label_fr: labelFr.trim(),
      signing_doc_path: path,
      signing_doc_name: safeName,
      signing_doc_mime: file.type || "application/pdf",
    });
    itemId = item.id;
  } catch {
    return { error: "generic" };
  }

  // Resolve the signer (client) — needed for the SignWell request. The firm +
  // magic token for the notification email are resolved lazily in
  // announceSignatureRequest, so we don't fetch them here.
  let client: Awaited<ReturnType<typeof getClient>> = null;
  try {
    client = await getClient(eng.client_id as string);
  } catch (e) {
    console.error("[addSignatureItemAction] client lookup failed:", e);
  }

  // Create the EMBEDDED SignWell request and record it. Non-fatal: the checklist
  // item already exists, so a failed setup records a row marked 'error' (the row
  // then surfaces "Signing setup needed" + a Retry) rather than silently doing
  // nothing. The create logic is shared with the retry path (createSignatureForItem).
  const testMode = isSignwellTestMode();
  const setup = await createSignatureForItem({
    engagementId,
    itemId,
    fileBase64,
    fileName: safeName,
    labelEn,
    labelFr,
    client,
  });

  await createSignatureRequest({
    firm_id: eng.firm_id as string,
    engagement_id: engagementId,
    request_item_id: itemId,
    signwell_document_id: setup.documentId,
    status: setup.status,
    test_mode: testMode,
    signer_email: client?.email ?? null,
    signer_name: client?.display_name ?? null,
    error_detail: setup.errorReason,
  });

  // A draft awaiting field placement is NOT out with the client yet: defer the
  // "signature_requested" audit + the client email to finalize (when it's sent).
  const awaitingPlacement =
    setup.status === "pending" &&
    setup.documentId !== null &&
    setup.editUrl !== null;

  if (!awaitingPlacement) {
    // Original path: audit the request (always — even a failed setup is a real
    // "they asked for a signature") and, unless setup failed, notify the client.
    await announceSignatureRequest({
      firmId: eng.firm_id as string,
      engagementId,
      itemId,
      labelEn: labelEn.trim(),
      labelFr: labelFr.trim(),
      testMode,
      signwellDocumentId: setup.documentId,
      notifyClient: setup.status !== "error",
    });
  }

  // Resolve the stage. A pending draft isn't outstanding, so this won't move the
  // engagement to "awaiting signature" until finalize flips it to 'sent'.
  await syncEngagementStage(sb, engagementId);

  revalidatePath(`/engagements/${engagementId}`);
  revalidatePath("/dashboard");
  return awaitingPlacement
    ? { ok: true, editUrl: setup.editUrl ?? undefined, itemId }
    : { ok: true };
}

// Create the SignWell document for a signature item and compute the resulting
// status / document id / editor URL / error reason. Does NO database writes — the
// caller records the row (insert on add, update on retry) — so the initial
// request and a retry share one code path and can't drift. Never throws: a
// SignWell failure comes back as status 'error' with a reason.
type SignatureSetupResult = {
  status: SignatureStatus;
  documentId: string | null;
  editUrl: string | null;
  errorReason: string | null;
};

async function createSignatureForItem(params: {
  engagementId: string;
  itemId: string;
  fileBase64: string;
  fileName: string;
  labelEn: string;
  labelFr: string;
  client: { email: string | null; display_name: string | null } | null;
}): Promise<SignatureSetupResult> {
  const useEditor = isSignwellEmbeddedEditingEnabled();

  if (!isSignwellConfigured()) {
    return {
      status: "error",
      documentId: null,
      editUrl: null,
      errorReason: "signwell_not_configured",
    };
  }
  if (!params.client?.email) {
    return {
      status: "error",
      documentId: null,
      editUrl: null,
      errorReason: "no_signer_email",
    };
  }

  try {
    const doc = await createSignatureDocument({
      name: (params.labelEn || params.labelFr).trim(),
      fileBase64: params.fileBase64,
      fileName: params.fileName,
      signerEmail: params.client.email,
      signerName: params.client.display_name,
      metadata: {
        request_item_id: params.itemId,
        engagement_id: params.engagementId,
      },
      embeddedEdit: useEditor,
    });
    if (useEditor) {
      // Editor mode: a draft awaiting field placement. A missing editor URL means
      // the API Application is misconfigured — treat as a setup error.
      if (doc.embeddedEditUrl) {
        return {
          status: "pending",
          documentId: doc.documentId,
          editUrl: doc.embeddedEditUrl,
          errorReason: null,
        };
      }
      return {
        status: "error",
        documentId: doc.documentId,
        editUrl: null,
        errorReason: "no_edit_url",
      };
    }
    // Default mode: sent immediately. A created document is at least 'sent' even
    // if SignWell momentarily reports "Draft" (-> pending).
    return {
      status: doc.status === "pending" ? "sent" : doc.status,
      documentId: doc.documentId,
      editUrl: null,
      errorReason: null,
    };
  } catch (e) {
    console.error("[createSignatureForItem] SignWell create failed:", e);
    return {
      status: "error",
      documentId: null,
      editUrl: null,
      errorReason:
        e instanceof SignwellError
          ? `${e.code}: ${e.message}`
          : (e as Error).message,
    };
  }
}

// Retry a signature request whose SignWell setup failed (status 'error', or a
// 'pending' row that never got a document): re-fetch the stored PDF, re-create
// the SignWell request, and update the row in place. Returns an editor URL to
// open (editor mode), a plain ok (sent), or an error + reason to surface. RLS-
// scoped: an accountant only resolves their own firm's item.
export async function retrySignatureSetupAction(itemId: string): Promise<{
  ok?: boolean;
  error?: string;
  reason?: string;
  editUrl?: string;
  itemId?: string;
}> {
  if (!itemId) return { error: "generic" };

  const sr = await getSignatureRequestByItem(itemId);
  if (!sr) return { error: "generic" };
  const retryable =
    sr.status === "error" ||
    (sr.status === "pending" && !sr.signwell_document_id);
  if (!retryable) return { ok: true }; // already set up — just refresh

  const sb = await getServerSupabase();
  const { data: item } = await sb
    .from("request_items")
    .select("signing_doc_path, signing_doc_name, label, label_fr")
    .eq("id", itemId)
    .maybeSingle();
  const docPath = (item as { signing_doc_path?: string } | null)
    ?.signing_doc_path;
  if (!docPath) return { error: "generic" };
  const docName =
    (item as { signing_doc_name?: string } | null)?.signing_doc_name ??
    "document.pdf";
  const labelEn = (item as { label?: string } | null)?.label ?? "";
  const labelFr = (item as { label_fr?: string } | null)?.label_fr ?? labelEn;

  const { data: eng } = await sb
    .from("engagements")
    .select("client_id")
    .eq("id", sr.engagement_id)
    .maybeSingle();
  const clientId = (eng as { client_id?: string } | null)?.client_id;
  let client: Awaited<ReturnType<typeof getClient>> = null;
  try {
    if (clientId) client = await getClient(clientId);
  } catch (e) {
    console.error("[retrySignatureSetupAction] client lookup failed:", e);
  }

  let fileBase64: string;
  try {
    fileBase64 = (await downloadObject(docPath)).toString("base64");
  } catch (e) {
    console.error("[retrySignatureSetupAction] doc download failed:", e);
    return { error: "generic" };
  }

  const setup = await createSignatureForItem({
    engagementId: sr.engagement_id,
    itemId,
    fileBase64,
    fileName: docName,
    labelEn,
    labelFr,
    client,
  });

  await updateSignatureRequestSetup(sr.id, {
    signwell_document_id: setup.documentId,
    status: setup.status,
    error_detail: setup.errorReason,
    signer_email: client?.email ?? null,
    signer_name: client?.display_name ?? null,
  });

  revalidatePath(`/engagements/${sr.engagement_id}`);
  revalidatePath("/dashboard");

  const awaitingPlacement =
    setup.status === "pending" &&
    setup.documentId !== null &&
    setup.editUrl !== null;
  if (awaitingPlacement) {
    return { ok: true, editUrl: setup.editUrl ?? undefined, itemId };
  }
  if (setup.status === "error") {
    return { error: "signwell", reason: setup.errorReason ?? undefined };
  }
  // Fallback (auto signature page) succeeded: it's sent now — notify + advance.
  await announceSignatureRequest({
    firmId: sr.firm_id,
    engagementId: sr.engagement_id,
    itemId,
    labelEn,
    labelFr,
    testMode: sr.test_mode,
    signwellDocumentId: setup.documentId,
    notifyClient: true,
  });
  await syncEngagementStage(sb, sr.engagement_id);
  return { ok: true };
}

// Audit that a signature request went out, and (optionally) email the client the
// "a document is waiting for your signature" notification. Shared by the
// immediate-send path and the finalize-after-placement path. Best-effort on the
// email: a mail hiccup never fails the caller (the item + request row exist).
async function announceSignatureRequest(opts: {
  firmId: string;
  engagementId: string;
  itemId: string;
  labelEn: string;
  labelFr: string;
  testMode: boolean;
  signwellDocumentId: string | null;
  notifyClient: boolean;
}): Promise<void> {
  await logUserActivity(opts.firmId, opts.engagementId, "signature_requested", {
    item_id: opts.itemId,
    label: opts.labelFr,
    test_mode: opts.testMode,
    ...(opts.signwellDocumentId
      ? { signwell_document_id: opts.signwellDocumentId }
      : {}),
  });

  if (!opts.notifyClient) return;

  try {
    const sb = await getServerSupabase();
    const { data: eng } = await sb
      .from("engagements")
      .select("client_id, magic_token")
      .eq("id", opts.engagementId)
      .maybeSingle();
    const magicToken = (eng as { magic_token?: string } | null)?.magic_token;
    const clientId = (eng as { client_id?: string } | null)?.client_id;
    if (!magicToken || !clientId) return;
    const [client, firm] = await Promise.all([
      getClient(clientId),
      getCurrentFirm(),
    ]);
    if (!client?.email || !firm) return;
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const url = `${appUrl}/r/${magicToken}`;
    const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
    const { subject, html, text } = buildSignatureRequestEmail({
      clientName: client.display_name,
      firmName: firm.name,
      firmLogoUrl,
      documentName: (client.locale === "en" ? opts.labelEn : opts.labelFr).trim(),
      url,
      locale: client.locale,
    });
    await sendEmail({ to: client.email, subject, html, text });
  } catch (e) {
    console.error("[announceSignatureRequest] failed:", e);
  }
}

// Release an embedded field-placement DRAFT once the accountant has positioned
// the signature field(s) in SignWell's editor: send the document, mark the
// request out for signature, notify the client, and advance the stage. Idempotent
// — a request already sent/signed (or a repeat call) is a no-op success.
export async function finalizeSignaturePlacementAction(
  itemId: string,
): Promise<{ ok?: boolean; error?: string }> {
  if (!itemId) return { error: "generic" };

  const sr = await getSignatureRequestByItem(itemId);
  if (!sr) return { error: "generic" };
  // Only a pending draft with a document can be finalized; anything else is
  // already out / signed / failed — treat as done so the UI just refreshes.
  if (sr.status !== "pending" || !sr.signwell_document_id) {
    return { ok: true };
  }
  const docId = sr.signwell_document_id;

  // The editor may itself have sent the draft when the accountant finished, so
  // re-check the live status — SignWell rejects sending a non-draft. Only send if
  // it's still a draft; otherwise adopt whatever status it already reached.
  let finalStatus: SignatureStatus;
  try {
    const state = await getDocument(docId);
    finalStatus =
      state.status === "pending" ? await sendDocument(docId) : state.status;
  } catch (e) {
    console.error("[finalizeSignaturePlacementAction] send failed:", e);
    return { error: "signwell" };
  }

  await updateSignatureRequestStatus(sr.id, finalStatus);

  // Resolve the item labels for the notification, then announce (audit + email).
  const sb = await getServerSupabase();
  const { data: item } = await sb
    .from("request_items")
    .select("label, label_fr")
    .eq("id", itemId)
    .maybeSingle();
  const labelEn = (item as { label?: string } | null)?.label ?? "";
  const labelFr = (item as { label_fr?: string } | null)?.label_fr ?? labelEn;

  await announceSignatureRequest({
    firmId: sr.firm_id,
    engagementId: sr.engagement_id,
    itemId,
    labelEn,
    labelFr,
    testMode: sr.test_mode,
    signwellDocumentId: docId,
    notifyClient: finalStatus !== "completed",
  });

  await syncEngagementStage(sb, sr.engagement_id);
  revalidatePath(`/engagements/${sr.engagement_id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

// Return a fresh field-placement editor URL for a pending draft, so the
// accountant can RESUME placing fields after closing the editor (the create-time
// URL expires once opened). RLS-scoped: an accountant only resolves their own
// firm's item.
export async function getSignaturePlacementUrlAction(
  itemId: string,
): Promise<{ url?: string; error?: string }> {
  if (!itemId) return { error: "generic" };
  const sr = await getSignatureRequestByItem(itemId);
  if (!sr || !sr.signwell_document_id) return { error: "generic" };
  if (sr.status !== "pending") return { error: "not_pending" };
  try {
    const state = await getDocument(sr.signwell_document_id);
    if (state.status !== "pending") return { error: "not_pending" };
    if (!state.embeddedEditUrl) return { error: "no_url" };
    return { url: state.embeddedEditUrl };
  } catch (e) {
    console.error("[getSignaturePlacementUrlAction] failed:", e);
    return { error: "signwell" };
  }
}

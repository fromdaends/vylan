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
  truncateFilename,
  getBrandingImageUrlForEmail,
} from "@/lib/storage";
import {
  createSignatureDocument,
  isSignwellConfigured,
  isSignwellTestMode,
  SignwellError,
  type SignatureStatus,
} from "@/lib/signwell/client";
import { createSignatureRequest } from "@/lib/db/signature-requests";
import { syncEngagementStage } from "@/lib/engagements/stage-sync";
import { sendEmail, buildSignatureRequestEmail } from "@/lib/email";
import type { ItemActionState } from "@/app/actions/items";

// Accountant creates a SIGNATURE item: they name it (FR + EN) and upload the PDF
// the client needs to sign. We store that document, create the item
// (kind='signature'), then create an EMBEDDED SignWell signature request (test
// mode while building) and record it in signature_requests. The client signs the
// document inside the Vylan portal (Phase 3); the signed copy + audit trail flow
// back via the SignWell webhook (Phase 4).
export async function addSignatureItemAction(
  _prev: ItemActionState,
  formData: FormData,
): Promise<ItemActionState> {
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

  // Resolve the signer (client) + firm once — needed for both the SignWell
  // request and the notification email.
  let client: Awaited<ReturnType<typeof getClient>> = null;
  let firm: Awaited<ReturnType<typeof getCurrentFirm>> = null;
  try {
    [client, firm] = await Promise.all([
      getClient(eng.client_id as string),
      getCurrentFirm(),
    ]);
  } catch (e) {
    console.error("[addSignatureItemAction] client/firm lookup failed:", e);
  }

  // Create the EMBEDDED SignWell signature request. Non-fatal: the checklist
  // item already exists, so if SignWell isn't configured yet or the call errors,
  // we still record a signature_requests row marked 'error' so the engagement
  // surfaces "signing setup needed" instead of silently doing nothing.
  const testMode = isSignwellTestMode();
  let srStatus: SignatureStatus = "pending";
  let srDocId: string | null = null;
  let srError: string | null = null;
  if (!isSignwellConfigured()) {
    srStatus = "error";
    srError = "signwell_not_configured";
  } else if (!client?.email) {
    srStatus = "error";
    srError = "no_signer_email";
  } else {
    try {
      const doc = await createSignatureDocument({
        name: (labelEn || labelFr).trim(),
        fileBase64,
        fileName: safeName,
        signerEmail: client.email,
        signerName: client.display_name,
        metadata: { request_item_id: itemId, engagement_id: engagementId },
      });
      srDocId = doc.documentId;
      // A non-draft document we just created is out for signature. SignWell's
      // create response can momentarily report "Draft" (which maps to 'pending');
      // don't let that strand the item as "Signing setup needed" — a created
      // document is at least 'sent'. The webhook/reconcile advance it from there.
      srStatus = doc.status === "pending" ? "sent" : doc.status;
    } catch (e) {
      srStatus = "error";
      srError =
        e instanceof SignwellError
          ? `${e.code}: ${e.message}`
          : (e as Error).message;
      console.error("[addSignatureItemAction] SignWell create failed:", e);
    }
  }

  await createSignatureRequest({
    firm_id: eng.firm_id as string,
    engagement_id: engagementId,
    request_item_id: itemId,
    signwell_document_id: srDocId,
    status: srStatus,
    test_mode: testMode,
    signer_email: client?.email ?? null,
    signer_name: client?.display_name ?? null,
    error_detail: srError,
  });

  // One clean audit row for the request (always — even if SignWell setup
  // failed, the accountant did request a signature and the item exists).
  await logUserActivity(
    eng.firm_id as string,
    engagementId,
    "signature_requested",
    {
      item_id: itemId,
      label: labelFr.trim(),
      test_mode: testMode,
      ...(srDocId ? { signwell_document_id: srDocId } : {}),
    },
  );

  // Tell the client a signature is waiting. Best-effort — never fail the action
  // on an email hiccup (the item already exists and shows in the portal).
  try {
    if (client?.email && firm && eng.magic_token) {
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const url = `${appUrl}/r/${eng.magic_token}`;
      const firmLogoUrl = await getBrandingImageUrlForEmail(firm.logo_url);
      const { subject, html, text } = buildSignatureRequestEmail({
        clientName: client.display_name,
        firmName: firm.name,
        firmLogoUrl,
        documentName: (client.locale === "en" ? labelEn : labelFr).trim(),
        url,
        locale: client.locale,
      });
      await sendEmail({ to: client.email, subject, html, text });
    }
  } catch (e) {
    console.error("[addSignatureItemAction] email failed:", e);
  }

  // A signature is now out with the client — the "first signature request sent"
  // transition. The resolver decides whether that actually moves the stage: a
  // request that failed to reach SignWell (status 'error') is the FIRM's problem,
  // not a wait on the client, so it doesn't count as outstanding.
  await syncEngagementStage(sb, engagementId);

  revalidatePath(`/engagements/${engagementId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

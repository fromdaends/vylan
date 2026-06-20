// Finalize a signed signature request: pull the completed PDF (with SignWell's
// audit page) and store it on the engagement, then mark the request completed.
//
// Shared by the webhook (real-time) and the reconcile backstop (self-heal when
// the webhook lags or is misconfigured). Idempotent: markSignatureCompletedSR
// is the single source of truth — it no-ops if the row is already completed, so
// concurrent webhook + reconcile can't double-log. A duplicate PDF upload just
// upserts the same object, which is harmless.

import { getCompletedPdf } from "@/lib/signwell/client";
import { signedDocPath, uploadObject } from "@/lib/storage";
import {
  markSignatureCompletedSR,
  type SignatureRequest,
} from "@/lib/db/signature-requests";
import { setItemStatus } from "@/lib/db/portal";
import { logServiceRoleActivity } from "@/lib/db/activity";

export async function finalizeSignatureCompletion(
  sr: SignatureRequest,
  event?: { type?: string | null; time?: string | null },
): Promise<boolean> {
  if (!sr.signwell_document_id) return false;
  // Already completed: just make sure the checklist item reflects it
  // (idempotent self-heal) and stop — no need to re-download the PDF. A signed
  // signature item must be 'approved' so a required signature doesn't keep the
  // engagement stuck "not ready to review" (computeAttention reads item.status).
  if (sr.status === "completed") {
    await setItemStatus(sr.request_item_id, "approved", sr.engagement_id);
    return true;
  }

  let pdf: Buffer;
  try {
    pdf = await getCompletedPdf(sr.signwell_document_id);
  } catch (e) {
    console.error("[signwell] getCompletedPdf failed:", e);
    return false;
  }

  const path = signedDocPath({
    firmId: sr.firm_id,
    engagementId: sr.engagement_id,
    documentId: sr.signwell_document_id,
  });
  try {
    await uploadObject({
      path,
      body: pdf,
      contentType: "application/pdf",
      upsert: true,
    });
  } catch (e) {
    console.error("[signwell] store signed PDF failed:", e);
    return false;
  }

  const res = await markSignatureCompletedSR(sr.id, {
    signedFilePath: path,
    eventType: event?.type ?? null,
    eventTime: event?.time ?? null,
  });
  // res is null when another path already completed it — don't double-log.
  if (res) {
    // Mark the checklist item approved so the engagement can read as ready to
    // review / complete (a required signature item otherwise stays 'pending').
    await setItemStatus(res.requestItemId, "approved", res.engagementId);
    await logServiceRoleActivity(
      res.firmId,
      res.engagementId,
      "signature_signed",
      {
        item_id: res.requestItemId,
        signwell_document_id: sr.signwell_document_id,
        test_mode: sr.test_mode,
      },
    );
  }
  return true;
}

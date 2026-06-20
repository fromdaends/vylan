// Self-heal a signature request straight from SignWell, independent of the
// webhook. The webhook is the real-time path; this is the backstop for when it
// lags or is misconfigured (this repo's webhooks have been flaky before — see
// the payments reconcile). Called when the accountant opens the engagement.
//
// Only touches a request that is still out for signature (sent/viewed): asks
// SignWell for the current state and, if it's completed, pulls the signed PDF and
// marks it done (idempotent via finalizeSignatureCompletion); otherwise nudges
// the stored status forward.

import { getDocument, type SignatureStatus } from "@/lib/signwell/client";
import { updateSignatureStatusSR, type SignatureRequest } from "@/lib/db/signature-requests";
import { finalizeSignatureCompletion } from "@/lib/signwell/complete";

export async function reconcileSignatureRequest(
  sr: SignatureRequest,
): Promise<SignatureStatus> {
  if (!sr.signwell_document_id) return sr.status;
  if (sr.status !== "sent" && sr.status !== "viewed") return sr.status;

  let doc: { status: SignatureStatus; embeddedSigningUrl: string | null };
  try {
    doc = await getDocument(sr.signwell_document_id);
  } catch {
    return sr.status; // SignWell unreachable — leave as-is, try again next load.
  }

  if (doc.status === "completed") {
    await finalizeSignatureCompletion(sr);
    return "completed";
  }
  if (doc.status !== sr.status) {
    await updateSignatureStatusSR(sr.id, doc.status);
    return doc.status;
  }
  return sr.status;
}

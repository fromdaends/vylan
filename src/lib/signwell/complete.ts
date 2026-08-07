// Finalize a signed signature request: pull the completed PDF (with SignWell's
// audit page) and store it on the engagement, then mark the request completed.
//
// Shared by the webhook (real-time) and the reconcile backstop (self-heal when
// the webhook lags or is misconfigured). Idempotent: markSignatureCompletedSR
// is the single source of truth — it no-ops if the row is already completed, so
// concurrent webhook + reconcile can't double-log. A duplicate PDF upload just
// upserts the same object, which is harmless.
//
// STAGE: the "all signature requests completed" transition needs no hook here.
// Both paths below end in setItemStatus, which re-resolves the engagement's
// stage — and both call it AFTER the signature row is marked completed, so the
// resolver sees the true signing state. Keep that ordering if this is refactored:
// syncing before the completion write would read a stale 'sent' and leave the
// engagement parked at awaiting_signature until the next event.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  clientName,
  emitSignatureCompleted,
  emitSignatureDeclined,
} from "@/lib/notifications/emit";
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
    // THE LETTER IS THE AGREEMENT (founder's ruling): a signed engagement
    // letter records the client's acceptance — one agree moment, not a
    // signature AND a separate accept tap. Only letter-keyed requests (the
    // automated engagement letter, 1580/1700) do this; an ordinary signature
    // on some other document says nothing about the proposal. Tolerant of
    // pre-1580 (no column → no letter requests exist) and first-writer-wins
    // like acceptEngagement itself; the acceptance sync then releases the
    // flow that was holding for this exact moment.
    try {
      const sbSR = getServiceRoleSupabase();
      const { data: lk } = await sbSR
        .from("signature_requests")
        .select("letter_key")
        .eq("id", sr.id)
        .maybeSingle();
      if ((lk as { letter_key?: string | null } | null)?.letter_key) {
        // Clears the decline like the plain-accept path does — a client who
        // declined and then signed has agreed, and leaving declined_at on
        // the row would show the firm a standing refusal on an accepted
        // engagement. Pre-1650 (no decline columns) retries without them.
        const acceptPatch = {
          accepted_at: new Date().toISOString(),
          accepted_by: "client",
        };
        let acceptRes = await sbSR
          .from("engagements")
          .update({ ...acceptPatch, declined_at: null, decline_reason: null })
          .eq("id", sr.engagement_id)
          .is("accepted_at", null)
          .select("id");
        if (
          acceptRes.error &&
          (acceptRes.error.code === "42703" ||
            acceptRes.error.code === "PGRST204")
        ) {
          acceptRes = await sbSR
            .from("engagements")
            .update(acceptPatch)
            .eq("id", sr.engagement_id)
            .is("accepted_at", null)
            .select("id");
        }
        // First writer only: the guard means a row came back exactly when
        // THIS signature recorded the acceptance.
        if (!acceptRes.error && (acceptRes.data?.length ?? 0) > 0) {
          await logServiceRoleActivity(
            sr.firm_id,
            sr.engagement_id,
            "engagement_accepted",
            { accepted_by: "client", via: "engagement_letter" },
          );
          // THE ACCEPTANCE'S CONSEQUENCES — the deposit, the on-acceptance
          // invoice, the recurring schedules, then the activation decision.
          // The same shared pipeline the portal's Accept button runs; without
          // it, sign-to-accept recorded agreements whose deposits were never
          // raised and whose portals opened unpaid (the review's blocker).
          const { runAcceptanceConsequences } = await import(
            "@/lib/engagements/on-accepted"
          );
          await runAcceptanceConsequences(sr.engagement_id);
        }
      }
    } catch (e) {
      console.error("[signwell] letter acceptance failed:", e);
    }

    // Mark the checklist item approved so the engagement can read as ready to
    // review / complete (a required signature item otherwise stays 'pending').
    // Runs AFTER the acceptance write above: setItemStatus re-syncs the
    // stage, and that sync must see the engagement as accepted so the flow
    // leaves its acceptance hold in the same beat as the signature.
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
    await emitSignatureNotification(res, "completed");
  }
  return true;
}

// Firm-facing notification for a signature outcome. Shared by the completion
// path here and the declined branch in the SignWell webhook, so both resolve
// the engagement and client the same way.
export async function emitSignatureNotification(
  res: { firmId: string; engagementId: string; requestItemId?: string | null },
  outcome: "completed" | "declined",
): Promise<void> {
  try {
    const sb = getServiceRoleSupabase();
    const [{ data: engRow }, { data: itemRow }] = await Promise.all([
      sb
        .from("engagements")
        .select("title, client_id")
        .eq("id", res.engagementId)
        .maybeSingle(),
      res.requestItemId
        ? sb
            .from("request_items")
            .select("label, label_fr")
            .eq("id", res.requestItemId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const eng = engRow as { title: string; client_id: string } | null;
    const item = itemRow as {
      label: string | null;
      label_fr: string | null;
    } | null;
    const documentName = item?.label?.trim() || item?.label_fr?.trim() || null;
    const ctx = {
      firmId: res.firmId,
      engagementId: res.engagementId,
      engagementTitle: eng?.title ?? null,
      clientId: eng?.client_id ?? null,
      clientName: await clientName(sb, eng?.client_id ?? null),
    };
    if (outcome === "completed") {
      await emitSignatureCompleted(sb, ctx, { documentName });
    } else {
      await emitSignatureDeclined(sb, ctx, { documentName });
    }
  } catch (err) {
    console.error("[signwell] signature notification failed:", err);
  }
}

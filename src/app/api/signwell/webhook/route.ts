// SignWell webhook. SignWell calls this when a document is viewed, signed,
// completed, declined, etc. On completion we pull the signed PDF + audit trail
// back into the engagement and mark the request signed.
//
// Security: every event is verified with HMAC-SHA256 over `${type}@${time}`
// keyed by our SIGNWELL_WEBHOOK_ID (isValidSignwellEventHash). An event that
// fails verification is rejected (401). Handling is idempotent — a re-delivered
// event is a no-op (markSignatureCompletedSR / updateSignatureStatusSR re-read
// the row), so SignWell's retries are safe.
//
// We always answer 2xx for events we recognize but choose not to act on, so
// SignWell doesn't retry them forever; the completion path also self-heals via
// reconcile if this endpoint is ever down or unconfigured.

import { NextResponse, type NextRequest } from "next/server";
import { isValidSignwellEventHash } from "@/lib/signwell/verify";
import {
  getSignatureRequestByDocumentIdSR,
  updateSignatureStatusSR,
} from "@/lib/db/signature-requests";
import { finalizeSignatureCompletion } from "@/lib/signwell/complete";

export const runtime = "nodejs";
export const maxDuration = 60;

type SignwellWebhookBody = {
  event?: { type?: string; time?: string | number; hash?: string };
  data?: { object?: { id?: string } };
};

export async function POST(request: NextRequest) {
  let body: SignwellWebhookBody;
  try {
    body = (await request.json()) as SignwellWebhookBody;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const event = body.event;
  if (!event?.type || event.hash == null || event.time == null) {
    return NextResponse.json({ error: "bad_event" }, { status: 400 });
  }

  const webhookId = process.env.SIGNWELL_WEBHOOK_ID?.trim();
  if (!webhookId) {
    // Can't verify without the key. Reject loudly; completion still self-heals
    // via reconcile when the accountant opens the engagement.
    console.error("[signwell webhook] SIGNWELL_WEBHOOK_ID is not set");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }
  if (
    !isValidSignwellEventHash({
      type: event.type,
      time: event.time,
      hash: String(event.hash),
      webhookId,
    })
  ) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  const documentId = body.data?.object?.id;
  if (!documentId) {
    return NextResponse.json({ ok: true, skipped: "no_document" });
  }

  const sr = await getSignatureRequestByDocumentIdSR(documentId);
  if (!sr) {
    // Not one of ours (or before migration 0400). Ack so SignWell stops retrying.
    return NextResponse.json({ ok: true, skipped: "unknown_document" });
  }

  const eventType = event.type;
  const eventTime = String(event.time);
  const evStatus = { eventType, eventTime };
  switch (event.type) {
    case "document_completed":
      await finalizeSignatureCompletion(sr, { type: eventType, time: eventTime });
      break;
    case "document_viewed":
      await updateSignatureStatusSR(sr.id, "viewed", evStatus);
      break;
    case "document_declined":
      await updateSignatureStatusSR(sr.id, "declined", evStatus);
      break;
    case "document_canceled":
      await updateSignatureStatusSR(sr.id, "canceled", evStatus);
      break;
    case "document_expired":
      await updateSignatureStatusSR(sr.id, "expired", evStatus);
      break;
    default:
      // Recognized-but-ignored (e.g. document_signed for our single signer —
      // document_completed is the authoritative completion). Ack.
      break;
  }

  return NextResponse.json({ ok: true });
}

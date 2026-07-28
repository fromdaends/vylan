// Thin, named wrappers around notify() for each real trigger in the app.
//
// Call sites stay one line and free of payload plumbing, and every payload is
// shaped in ONE place — which matters because the payload keys
// (client_name, engagement_title, document_name, amount, actor_name, count,
// href, note) are a contract with both the feed renderer
// (src/lib/notifications/feed.ts) and the email copy
// (src/lib/notifications/email-copy.ts). Scattering that contract across
// thirteen files is how it drifts.
//
// Every function here inherits notify()'s guarantee: it never throws, so a
// notification failure can never break the upload, webhook or action that
// triggered it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { notify, type NotifyInput } from "./notify";

type Sb = SupabaseClient;

/**
 * Swallow anything a notification path throws.
 *
 * notify() already guarantees this for itself, but the helpers here run BEFORE
 * it — resolving a client name, building a Supabase client — and a throw there
 * would escape into the caller and break the upload, payment or webhook the
 * notification is merely reporting on. That is the exact failure this wrapper
 * exists to prevent, and it is not hypothetical: creating a service-role client
 * throws outright when the environment is not fully configured.
 */
async function guard<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[notify] ${label} failed:`, err);
    return null;
  }
}

// Client display name, resolved once. Returns null rather than throwing so a
// missing client just yields a less specific notification.
export async function clientName(
  sb: Sb,
  clientId: string | null | undefined,
): Promise<string | null> {
  if (!clientId) return null;
  return guard(async () => {
    const { data } = await sb
      .from("clients")
      .select("display_name")
      .eq("id", clientId)
      .maybeSingle();
    return (data as { display_name: string } | null)?.display_name ?? null;
  }, "clientName");
}

export async function userName(
  sb: Sb,
  userId: string | null | undefined,
): Promise<string | null> {
  if (!userId) return null;
  return guard(async () => {
    const { data } = await sb
      .from("users")
      .select("name, display_name")
      .eq("id", userId)
      .maybeSingle();
    const u = data as {
      name: string | null;
      display_name: string | null;
    } | null;
    return u?.display_name?.trim() || u?.name?.trim() || null;
  }, "userName");
}

type EngagementContext = {
  firmId: string;
  engagementId: string;
  engagementTitle: string | null;
  clientId: string | null;
  clientName: string | null;
};

// The shared shape for anything that happens inside an engagement.
function engagementNotify(
  ctx: EngagementContext,
  eventKey: string,
  extra: {
    actorId?: string | null;
    payload?: Record<string, unknown>;
    entity?: NotifyInput["entity"];
  } = {},
): Promise<unknown> {
  return guard(() => notify({
    firmId: ctx.firmId,
    eventKey,
    entity: extra.entity ?? { type: "engagement", id: ctx.engagementId },
    actorId: extra.actorId ?? null,
    engagementId: ctx.engagementId,
    clientId: ctx.clientId,
    payload: {
      engagement_title: ctx.engagementTitle,
      client_name: ctx.clientName,
      href: `/engagements/${ctx.engagementId}`,
      ...extra.payload,
    },
  }), `engagementNotify:${eventKey}`);
}

export async function emitDocumentUploaded(
  sb: Sb,
  ctx: EngagementContext,
  opts: { fileId: string },
): Promise<void> {
  await engagementNotify(ctx, "document.uploaded", {
    entity: { type: "engagement", id: ctx.engagementId },
    // count:1 per upload; the emitter's bundling accumulates it, so a client
    // sending eight files produces one row reading "8".
    payload: { count: 1, file_id: opts.fileId },
  });
}

export async function emitRequestComplete(
  sb: Sb,
  ctx: EngagementContext,
): Promise<void> {
  await engagementNotify(ctx, "document.request_complete");
}

export async function emitSignedCopyReturned(
  sb: Sb,
  ctx: EngagementContext,
  opts: { documentName: string | null },
): Promise<void> {
  await engagementNotify(ctx, "signature.signed_copy_returned", {
    payload: { document_name: opts.documentName },
  });
}

export async function emitSignatureCompleted(
  sb: Sb,
  ctx: EngagementContext,
  opts: { documentName: string | null },
): Promise<void> {
  await engagementNotify(ctx, "signature.completed", {
    payload: { document_name: opts.documentName },
  });
}

export async function emitSignatureDeclined(
  sb: Sb,
  ctx: EngagementContext,
  opts: { documentName: string | null },
): Promise<void> {
  await engagementNotify(ctx, "signature.declined", {
    payload: { document_name: opts.documentName },
  });
}

// The three AI outcomes. Kept as separate catalog events (not one
// "needs review") so a firm can hear about an escalation without also hearing
// about every routine flag.
export async function emitAiOutcome(
  sb: Sb,
  ctx: EngagementContext,
  opts: {
    outcome: "flagged" | "rejected" | "escalated";
    documentName: string | null;
    fileId: string | null;
  },
): Promise<void> {
  const eventKey =
    opts.outcome === "flagged"
      ? "document.ai_flagged"
      : opts.outcome === "rejected"
        ? "document.ai_rejected"
        : "document.ai_escalated";
  await engagementNotify(ctx, eventKey, {
    payload: {
      document_name: opts.documentName,
      file_id: opts.fileId,
      count: 1,
    },
  });
}

export async function emitEngagementCompleted(
  sb: Sb,
  ctx: EngagementContext,
  opts: { actorId: string | null },
): Promise<void> {
  await engagementNotify(ctx, "engagement.completed", {
    actorId: opts.actorId,
  });
}

export async function emitEngagementAssigned(
  sb: Sb,
  ctx: EngagementContext,
  opts: { actorId: string | null; assigneeId: string; note?: string | null },
): Promise<void> {
  const actorName = await userName(sb, opts.actorId);
  await guard(() => notify({
    firmId: ctx.firmId,
    eventKey: "engagement.assigned_to_you",
    entity: { type: "engagement", id: ctx.engagementId },
    actorId: opts.actorId,
    engagementId: ctx.engagementId,
    clientId: ctx.clientId,
    // Personally targeted: only the person the work landed on, regardless of
    // anyone else's scope setting.
    recipients: [opts.assigneeId],
    payload: {
      engagement_title: ctx.engagementTitle,
      client_name: ctx.clientName,
      actor_name: actorName,
      note: opts.note ?? null,
      href: `/engagements/${ctx.engagementId}`,
    },
  }), "emit");
}

export async function emitPaymentEvent(
  sb: Sb,
  ctx: EngagementContext,
  opts: {
    outcome: "received" | "failed";
    amount: string | null;
    invoiceId: string | null;
  },
): Promise<void> {
  await guard(() => notify({
    firmId: ctx.firmId,
    eventKey: opts.outcome === "received" ? "payment.received" : "payment.failed",
    entity: opts.invoiceId
      ? { type: "invoice", id: opts.invoiceId }
      : { type: "engagement", id: ctx.engagementId },
    engagementId: ctx.engagementId,
    clientId: ctx.clientId,
    payload: {
      engagement_title: ctx.engagementTitle,
      client_name: ctx.clientName,
      amount: opts.amount,
      href: `/engagements/${ctx.engagementId}`,
    },
  }), "emit");
}

export async function emitClientMessage(
  sb: Sb,
  ctx: EngagementContext,
): Promise<void> {
  await engagementNotify(ctx, "message.client_replied", {
    payload: {
      count: 1,
      // Deep-links into the panel's Client-messages tab, matching what the old
      // derived feed did for this kind.
      href: `/engagements/${ctx.engagementId}?panel=messages`,
    },
  });
}

export async function emitInternalMention(
  sb: Sb,
  ctx: EngagementContext,
  opts: { actorId: string | null; mentionedUserIds: string[] },
): Promise<void> {
  if (opts.mentionedUserIds.length === 0) return;
  const actorName = await userName(sb, opts.actorId);
  await guard(() => notify({
    firmId: ctx.firmId,
    eventKey: "message.internal_mention",
    entity: { type: "engagement", id: ctx.engagementId },
    actorId: opts.actorId,
    engagementId: ctx.engagementId,
    clientId: ctx.clientId,
    recipients: opts.mentionedUserIds,
    payload: {
      engagement_title: ctx.engagementTitle,
      client_name: ctx.clientName,
      actor_name: actorName,
      href: `/engagements/${ctx.engagementId}`,
    },
  }), "emit");
}

export async function emitClientPortalFirstOpened(
  sb: Sb,
  opts: {
    firmId: string;
    clientId: string | null;
    clientName: string | null;
    engagementId: string | null;
    engagementTitle: string | null;
  },
): Promise<void> {
  await guard(() => notify({
    firmId: opts.firmId,
    eventKey: "client.portal_first_opened",
    entity: opts.clientId ? { type: "client", id: opts.clientId } : null,
    engagementId: opts.engagementId,
    clientId: opts.clientId,
    payload: {
      client_name: opts.clientName,
      engagement_title: opts.engagementTitle,
      href: opts.clientId ? `/clients/${opts.clientId}` : "/clients",
    },
  }), "emitClientPortalFirstOpened");
}

export async function emitTeamMemberJoined(
  sb: Sb,
  opts: { firmId: string; newUserId: string; newUserName: string | null },
): Promise<void> {
  await guard(() => notify({
    firmId: opts.firmId,
    eventKey: "team.member_joined",
    entity: null,
    // The joiner IS the actor, so the actor rule keeps them from being told
    // about their own arrival.
    actorId: opts.newUserId,
    payload: {
      actor_name: opts.newUserName,
      href: "/settings/team",
    },
  }), "emitTeamMemberJoined");
}

export async function emitIntegrationEvent(
  sb: Sb,
  opts: {
    firmId: string;
    outcome: "sync_failed" | "disconnected";
    provider: string;
    actorId?: string | null;
  },
): Promise<void> {
  await guard(() => notify({
    firmId: opts.firmId,
    eventKey:
      opts.outcome === "sync_failed"
        ? "integration.sync_failed"
        : "integration.disconnected",
    entity: null,
    actorId: opts.actorId ?? null,
    payload: {
      provider: opts.provider,
      // A broken connection re-fails on every run; bundling collapses it, and
      // the count tells the owner how long it has been going.
      count: 1,
      href: "/integrations",
    },
  }), "emitIntegrationEvent");
}

export async function emitBillingPaymentFailed(
  sb: Sb,
  opts: { firmId: string; amount: string | null },
): Promise<void> {
  await guard(() => notify({
    firmId: opts.firmId,
    eventKey: "billing.payment_failed",
    entity: null,
    payload: {
      amount: opts.amount,
      href: "/settings?tab=payments",
    },
  }), "emitBillingPaymentFailed");
}

// Portal queries — used by the unauthenticated /r/[token] route and its
// API actions. Always goes through the service-role client; never through
// the user's session client.
//
// SECURITY: The only valid entry point is `loadPortalContext(token)`, which
// verifies the token format AND that an engagement matches AND that the
// expiry hasn't passed. Every other helper assumes the token has already
// been validated.

import { getServiceRoleSupabase } from "@/lib/supabase/server";
import type { Engagement } from "./engagements";
import type { Client } from "./clients";
import type { Firm } from "./firms";
import type { RequestItem, RequestItemStatus } from "./request-items";
import type { UsabilityVerdict } from "@/lib/ai/usability";

const TOKEN_REGEX = /^[0-9A-Za-z]{43}$/;

export function isValidTokenShape(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

export type PortalFile = {
  id: string;
  name: string;
  status: "pending" | "approved" | "rejected";
};

export type PortalContext = {
  engagement: Engagement;
  client: Client;
  firm: Firm;
  items: RequestItem[];
  uploaded_count_by_item: Record<string, number>;
  // The files the client has actually sent for each item (oldest first), each
  // with the accountant's per-file decision. Powers the portal's per-document
  // list + re-upload. Client-safe: only the client's own filename + a simple
  // status (never AI codes, scores, or the word "flagged").
  files_by_item: Record<string, PortalFile[]>;
  // Bilingual AI rejection summary per item, taken from the latest upload's
  // usability verdict (the model writes it in both languages). Lets the
  // portal's re-upload banner follow the language toggle instead of being stuck
  // in the single language `request_items.rejection_reason` was written in.
  // Only present for items whose latest upload was flagged.
  rejection_summary_by_item: Record<string, { fr: string; en: string }>;
  // The "your accountant" contact surfaced in the portal footer. Resolves to
  // the user assigned to the engagement, falling back to the firm owner. Null
  // only if neither has an email on file (shouldn't happen — users.email is
  // NOT NULL — but the footer degrades gracefully if it ever is).
  accountant_email: string | null;
};

export async function loadPortalContext(
  token: string,
): Promise<PortalContext | null> {
  if (!isValidTokenShape(token)) return null;
  const sb = getServiceRoleSupabase();

  const { data: engagement, error: e1 } = await sb
    .from("engagements")
    .select("*")
    .eq("magic_token", token)
    .maybeSingle();
  if (e1 || !engagement) return null;
  if (engagement.status === "cancelled") return null;
  if (
    engagement.magic_expires_at &&
    new Date(engagement.magic_expires_at) < new Date()
  ) {
    return null;
  }

  const { data: client } = await sb
    .from("clients")
    .select("*")
    .eq("id", engagement.client_id)
    .single();
  const { data: firm } = await sb
    .from("firms")
    .select("*")
    .eq("id", engagement.firm_id)
    .single();
  const { data: items } = await sb
    .from("request_items")
    .select("*")
    .eq("engagement_id", engagement.id)
    .order("order_index", { ascending: true });

  if (!client || !firm || !items) return null;

  const { data: uploaded } = await sb
    .from("uploaded_files")
    .select(
      "id, request_item_id, original_filename, review_status, uploaded_at, ai_usability",
    )
    .eq("engagement_id", engagement.id)
    .order("uploaded_at", { ascending: true });
  const counts: Record<string, number> = {};
  // Ascending order → the last write per item wins, so this reflects the
  // LATEST upload's verdict. A later clean upload supersedes an earlier flag.
  const rejectionSummaryByItem: Record<string, { fr: string; en: string }> = {};
  // The per-item file list (oldest first, matching the query order).
  const filesByItem: Record<string, PortalFile[]> = {};
  for (const u of uploaded ?? []) {
    counts[u.request_item_id] = (counts[u.request_item_id] ?? 0) + 1;
    (filesByItem[u.request_item_id] ??= []).push({
      id: u.id as string,
      name: (u.original_filename as string) ?? "",
      status: (u.review_status as PortalFile["status"]) ?? "pending",
    });
    const v = u.ai_usability as UsabilityVerdict | null;
    const fr = v?.issue_summary_fr?.trim();
    const en = v?.issue_summary_en?.trim();
    if (fr || en) {
      rejectionSummaryByItem[u.request_item_id] = {
        fr: fr || en || "",
        en: en || fr || "",
      };
    } else {
      delete rejectionSummaryByItem[u.request_item_id];
    }
  }

  // Resolve the accountant contact for the footer: the user assigned to this
  // engagement if one is set, otherwise the firm owner (earliest-created, in
  // case of multiple owners). Service-role read — the portal is unauthenticated.
  let accountantEmail: string | null = null;
  if (engagement.assigned_user_id) {
    const { data: assigned } = await sb
      .from("users")
      .select("email")
      .eq("id", engagement.assigned_user_id)
      .maybeSingle();
    accountantEmail = (assigned?.email as string | undefined) ?? null;
  }
  if (!accountantEmail) {
    const { data: owner } = await sb
      .from("users")
      .select("email")
      .eq("firm_id", engagement.firm_id)
      .eq("role", "owner")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    accountantEmail = (owner?.email as string | undefined) ?? null;
  }

  return {
    engagement: engagement as Engagement,
    client: client as Client,
    firm: firm as Firm,
    items: items as RequestItem[],
    uploaded_count_by_item: counts,
    files_by_item: filesByItem,
    rejection_summary_by_item: rejectionSummaryByItem,
    accountant_email: accountantEmail,
  };
}

// Used exclusively by write endpoints (upload, mark-na, undo-na). Blocks
// any engagement state where further mutation shouldn't be allowed:
// cancelled (rejected outright) or complete (work already finished).
export async function findItemForToken(
  token: string,
  itemId: string,
): Promise<RequestItem | null> {
  if (!isValidTokenShape(token)) return null;
  const sb = getServiceRoleSupabase();
  const { data: engagement } = await sb
    .from("engagements")
    .select("id, magic_expires_at, status")
    .eq("magic_token", token)
    .maybeSingle();
  if (!engagement) return null;
  if (engagement.status === "cancelled" || engagement.status === "complete") {
    return null;
  }
  if (
    engagement.magic_expires_at &&
    new Date(engagement.magic_expires_at) < new Date()
  ) {
    return null;
  }
  const { data: item } = await sb
    .from("request_items")
    .select("*")
    .eq("id", itemId)
    .eq("engagement_id", engagement.id)
    .maybeSingle();
  return (item as RequestItem) ?? null;
}

// Defense in depth: scope updates to (id, engagement_id) so a stale or wrong
// itemId can't accidentally mutate items in another engagement, even if a
// future refactor of findItemForToken stops scoping correctly.
export async function setItemStatus(
  itemId: string,
  status: RequestItemStatus,
  engagementId?: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  let q = sb.from("request_items").update({ status }).eq("id", itemId);
  if (engagementId) q = q.eq("engagement_id", engagementId);
  const { error } = await q;
  if (error) throw error;
}

export async function markEngagementInProgress(
  engagementId: string,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  await sb
    .from("engagements")
    .update({ status: "in_progress" })
    .eq("id", engagementId)
    .eq("status", "sent");
}

export async function logActivity(
  firmId: string,
  engagementId: string,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const sb = getServiceRoleSupabase();
  await sb.from("activity_log").insert({
    firm_id: firmId,
    engagement_id: engagementId,
    actor_type: "client",
    action,
    metadata,
  });
}

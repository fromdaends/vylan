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

const TOKEN_REGEX = /^[0-9A-Za-z]{43}$/;

export function isValidTokenShape(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

export type PortalContext = {
  engagement: Engagement;
  client: Client;
  firm: Firm;
  items: RequestItem[];
  uploaded_count_by_item: Record<string, number>;
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
    .select("request_item_id")
    .eq("engagement_id", engagement.id);
  const counts: Record<string, number> = {};
  for (const u of uploaded ?? []) {
    counts[u.request_item_id] = (counts[u.request_item_id] ?? 0) + 1;
  }

  return {
    engagement: engagement as Engagement,
    client: client as Client,
    firm: firm as Firm,
    items: items as RequestItem[],
    uploaded_count_by_item: counts,
  };
}

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
  if (!engagement || engagement.status === "cancelled") return null;
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

export async function setItemStatus(
  itemId: string,
  status: RequestItemStatus,
): Promise<void> {
  const sb = getServiceRoleSupabase();
  const { error } = await sb
    .from("request_items")
    .update({ status })
    .eq("id", itemId);
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

// Who works on a client — reading and writing the cast.
//
// ⚠️ THIS LIST NOW GRANTS SIGHT (slice 2, migration 1220). Being on a client
// lets you see it and its engagements even when it is private. What it does NOT
// yet do is take sight away — everyone who could see a non-private client still
// can, whether or not they are on it. Slice 3 is what narrows that, and it is
// the one the founder reviews before it runs.
//
// READS DEGRADE, WRITES REFUSE, same as month-close.ts. Before 1210 is applied
// there is no table: a read returns "no cast recorded", which is exactly what
// the panel should show, and a write says which file to run rather than failing
// with a Postgres error nobody can act on.

import { getServerSupabase } from "@/lib/supabase/server";
import { isMissingSchema } from "@/lib/db/quickbooks";

export type ClientMember = {
  id: string;
  clientId: string;
  userId: string;
  position: string | null;
  createdAt: string;
};

export class ClientMembersUnsupportedError extends Error {
  constructor() {
    super(
      "Client teams need database update 1210. Run supabase/migrations/1210_client_members.sql, then try again.",
    );
    this.name = "ClientMembersUnsupportedError";
  }
}

function toMember(r: Record<string, unknown>): ClientMember | null {
  const id = typeof r.id === "string" ? r.id : null;
  const clientId = typeof r.client_id === "string" ? r.client_id : null;
  const userId = typeof r.user_id === "string" ? r.user_id : null;
  if (!id || !clientId || !userId) return null;
  return {
    id,
    clientId,
    userId,
    position: typeof r.position === "string" && r.position.trim() ? r.position : null,
    createdAt: String(r.created_at ?? ""),
  };
}

/** The cast on one client, oldest first — the order they were added. */
export async function listClientMembers(
  clientId: string,
): Promise<ClientMember[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("client_members")
    .select("id, client_id, user_id, position, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return [];
    throw error;
  }
  return (data ?? [])
    .map((r) => toMember(r as Record<string, unknown>))
    .filter((m): m is ClientMember => m !== null);
}

/**
 * The cast on many clients at once, keyed by client id.
 *
 * One query rather than one per client: the clients list would otherwise open
 * with a round trip per row before it drew anything.
 */
export async function listClientMembersByClient(
  clientIds: string[],
): Promise<Map<string, ClientMember[]>> {
  const out = new Map<string, ClientMember[]>();
  if (clientIds.length === 0) return out;
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("client_members")
    .select("id, client_id, user_id, position, created_at")
    .in("client_id", clientIds)
    .order("created_at", { ascending: true });
  if (error) {
    if (isMissingSchema(error)) return out;
    throw error;
  }
  for (const row of data ?? []) {
    const m = toMember(row as Record<string, unknown>);
    if (!m) continue;
    const list = out.get(m.clientId);
    if (list) list.push(m);
    else out.set(m.clientId, [m]);
  }
  return out;
}

/**
 * Put somebody on a client, or update the position of somebody already on it.
 *
 * Upserts on (client_id, user_id): adding the same person twice is a no-op
 * rather than a second row or an error, which matters on a screen two people
 * might have open.
 */
export async function addClientMember(input: {
  firmId: string;
  clientId: string;
  userId: string;
  position?: string | null;
  actorId?: string | null;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.from("client_members").upsert(
    {
      firm_id: input.firmId,
      client_id: input.clientId,
      user_id: input.userId,
      position: input.position?.trim() || null,
      created_by: input.actorId ?? null,
    },
    { onConflict: "client_id,user_id" },
  );
  if (error) {
    if (isMissingSchema(error)) throw new ClientMembersUnsupportedError();
    throw error;
  }
}

/** Take somebody off a client. */
export async function removeClientMember(input: {
  clientId: string;
  userId: string;
}): Promise<void> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("client_members")
    .delete()
    .eq("client_id", input.clientId)
    .eq("user_id", input.userId);
  if (error) {
    if (isMissingSchema(error)) throw new ClientMembersUnsupportedError();
    throw error;
  }
}

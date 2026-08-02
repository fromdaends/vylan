"use server";

// Adding and removing people from a client's cast.
//
// Owner-only to CHANGE, for now. Not because that is the end state — by slice 3
// a client's manager is the obvious person to run their own cast — but because
// this list is about to decide who can SEE a client, and handing out the right
// to edit it before it means anything would quietly hand out the right to grant
// access before anyone reviewed that decision.
//
// This file exports async functions ONLY. A "use server" module that exports a
// constant compiles fine and then fails the production build naming the wrong
// thing.

import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { can } from "@/lib/auth/capabilities";
import { getServiceRoleSupabase } from "@/lib/supabase/server";
import {
  addClientMember,
  removeClientMember,
  ClientMembersUnsupportedError,
} from "@/lib/db/client-members";
import { logUserActivity } from "@/lib/db/activity";
import { revalidateAllLocales } from "@/lib/revalidate";

export type ClientMemberResult = {
  ok: boolean;
  /** Set when database update 1210 has not been applied yet. */
  needsMigration?: boolean;
  error?: "no_session" | "not_allowed" | "not_found" | "save_failed";
};

// Both the client and the person must belong to the caller's own firm. The
// service-role read below does not enforce that for us, which is exactly why
// it is checked here — a client id from another firm would otherwise be
// perfectly writable.
async function assertSameFirm(
  firmId: string,
  clientId: string,
  userId: string,
): Promise<boolean> {
  const admin = getServiceRoleSupabase();
  const [{ data: client }, { data: person }] = await Promise.all([
    admin.from("clients").select("id, firm_id").eq("id", clientId).maybeSingle(),
    admin.from("users").select("id, firm_id").eq("id", userId).maybeSingle(),
  ]);
  return (
    !!client &&
    !!person &&
    client.firm_id === firmId &&
    person.firm_id === firmId
  );
}

export async function addClientMemberAction(input: {
  clientId: string;
  userId: string;
  position?: string | null;
}): Promise<ClientMemberResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (!can(user, "clients.manage")) return { ok: false, error: "not_allowed" };
  if (!input.clientId || !input.userId) return { ok: false, error: "not_found" };
  if (!(await assertSameFirm(firm.id, input.clientId, input.userId))) {
    return { ok: false, error: "not_found" };
  }

  try {
    await addClientMember({
      firmId: firm.id,
      clientId: input.clientId,
      userId: input.userId,
      position: input.position ?? null,
      actorId: user.id,
    });
  } catch (err) {
    if (err instanceof ClientMembersUnsupportedError) {
      return { ok: false, needsMigration: true };
    }
    console.error("[client members] add failed:", err);
    return { ok: false, error: "save_failed" };
  }

  try {
    await logUserActivity(firm.id, null, "client_member_added", {
      client_id: input.clientId,
      user_id: input.userId,
    });
  } catch (err) {
    console.error("[client members] audit log failed (member added):", err);
  }
  revalidateAllLocales(`/clients/${input.clientId}`);
  return { ok: true };
}

export async function removeClientMemberAction(input: {
  clientId: string;
  userId: string;
}): Promise<ClientMemberResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (!can(user, "clients.manage")) return { ok: false, error: "not_allowed" };
  if (!input.clientId || !input.userId) return { ok: false, error: "not_found" };
  if (!(await assertSameFirm(firm.id, input.clientId, input.userId))) {
    return { ok: false, error: "not_found" };
  }

  try {
    await removeClientMember({
      clientId: input.clientId,
      userId: input.userId,
    });
  } catch (err) {
    if (err instanceof ClientMembersUnsupportedError) {
      return { ok: false, needsMigration: true };
    }
    console.error("[client members] remove failed:", err);
    return { ok: false, error: "save_failed" };
  }

  try {
    await logUserActivity(firm.id, null, "client_member_removed", {
      client_id: input.clientId,
      user_id: input.userId,
    });
  } catch (err) {
    console.error("[client members] audit log failed (member removed):", err);
  }
  revalidateAllLocales(`/clients/${input.clientId}`);
  return { ok: true };
}

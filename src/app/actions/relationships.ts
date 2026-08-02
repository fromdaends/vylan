"use server";

import { revalidatePath } from "next/cache";
import { getClient } from "@/lib/db/clients";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { can } from "@/lib/auth/capabilities";
import { logUserActivity } from "@/lib/db/activity";
import {
  createRelationship,
  getRelationship,
  restoreRelationship,
  softDeleteRelationship,
  updateRelationshipDetail,
} from "@/lib/db/relationships";
import {
  validateRelationship,
  type RelationshipValidationError,
} from "@/lib/relationships/validate";

export type RelationshipActionError =
  | RelationshipValidationError
  | "forbidden"
  | "no_session"
  | "client_not_found"
  | "client_archived"
  | "duplicate"
  | "spouse_taken"
  | "not_found"
  | "rejected";

export type RelationshipActionResult =
  | { ok: true }
  | { ok: false; error: RelationshipActionError };

// Never trust the dialog: every rule from the spec is re-checked here against
// freshly loaded clients, and the database (1150 CHECKs + guard trigger)
// re-enforces all of it once more underneath. Loading both ends via the
// RLS-scoped getClient also proves they exist IN THIS FIRM — another firm's
// client id, or a private client this staff user can't see, reads as null.
export async function createRelationshipAction(input: {
  relType: string;
  fromClientId: string;
  toClientId: string;
  percentage?: number | null;
  scopes?: string[] | null;
}): Promise<RelationshipActionResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  // Same gate as editing the client itself: relationships are client metadata.
  if (!can(user, "clients.manage")) return { ok: false, error: "forbidden" };

  const [from, to] = await Promise.all([
    getClient(input.fromClientId),
    getClient(input.toClientId),
  ]);
  if (!from || !to || from.firm_id !== firm.id || to.firm_id !== firm.id) {
    return { ok: false, error: "client_not_found" };
  }
  // Links are between ACTIVE clients; an archived client is not in the picker
  // and must not be reachable by calling the action directly.
  if (from.archived_at || to.archived_at) {
    return { ok: false, error: "client_archived" };
  }

  const validated = validateRelationship({
    relType: input.relType,
    from: { id: from.id, type: from.type },
    to: { id: to.id, type: to.type },
    percentage: input.percentage,
    scopes: input.scopes,
  });
  if (!validated.ok) return { ok: false, error: validated.error };

  const res = await createRelationship({
    firm_id: firm.id,
    from_client_id: validated.fromClientId,
    to_client_id: validated.toClientId,
    rel_type: validated.relType,
    percentage: validated.percentage,
    scopes: validated.scopes,
    created_by: user.id,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await logUserActivity(firm.id, null, "client_relationship_created", {
    client_id: validated.fromClientId,
    related_client_id: validated.toClientId,
    rel_type: validated.relType,
    ...(validated.percentage != null && { percentage: validated.percentage }),
    ...(validated.scopes != null && { scopes: validated.scopes }),
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

// Edit = the type-specific detail only (owner percentage / contact scopes).
// Endpoints and type never change on an existing link — that's remove + add.
export async function updateRelationshipAction(input: {
  id: string;
  percentage?: number | null;
  scopes?: string[] | null;
}): Promise<RelationshipActionResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (!can(user, "clients.manage")) return { ok: false, error: "forbidden" };

  const rel = await getRelationship(input.id);
  if (!rel || rel.firm_id !== firm.id || rel.deleted_at) {
    return { ok: false, error: "not_found" };
  }

  // Re-validate the edited detail under the EXISTING link's type and ends.
  const [from, to] = await Promise.all([
    getClient(rel.from_client_id),
    getClient(rel.to_client_id),
  ]);
  if (!from || !to) return { ok: false, error: "client_not_found" };
  const validated = validateRelationship({
    relType: rel.rel_type,
    from: { id: from.id, type: from.type },
    to: { id: to.id, type: to.type },
    percentage:
      rel.rel_type === "owner_of" ? input.percentage : undefined,
    scopes:
      rel.rel_type === "authorized_contact" ? input.scopes : undefined,
  });
  if (!validated.ok) return { ok: false, error: validated.error };
  // A spouse link has no editable detail.
  if (rel.rel_type === "spouse_of") return { ok: true };

  const res = await updateRelationshipDetail(rel.id, {
    percentage: validated.percentage,
    scopes: validated.scopes,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await logUserActivity(firm.id, null, "client_relationship_updated", {
    client_id: rel.from_client_id,
    related_client_id: rel.to_client_id,
    rel_type: rel.rel_type,
    ...(validated.percentage != null && { percentage: validated.percentage }),
    ...(validated.scopes != null && { scopes: validated.scopes }),
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeRelationshipAction(
  id: string,
): Promise<RelationshipActionResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (!can(user, "clients.manage")) return { ok: false, error: "forbidden" };

  const rel = await getRelationship(id);
  if (!rel || rel.firm_id !== firm.id || rel.deleted_at) {
    return { ok: false, error: "not_found" };
  }

  const res = await softDeleteRelationship(rel.id);
  if (!res.ok) return { ok: false, error: "rejected" };

  await logUserActivity(firm.id, null, "client_relationship_removed", {
    client_id: rel.from_client_id,
    related_client_id: rel.to_client_id,
    rel_type: rel.rel_type,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

// The undo toast's restore. Only manually removed links come back this way;
// archive-hidden ones are restored by restoring the client.
export async function restoreRelationshipAction(
  id: string,
): Promise<RelationshipActionResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  if (!can(user, "clients.manage")) return { ok: false, error: "forbidden" };

  const rel = await getRelationship(id);
  if (!rel || rel.firm_id !== firm.id || !rel.deleted_at) {
    return { ok: false, error: "not_found" };
  }

  const res = await restoreRelationship(rel.id);
  if (!res.ok) return { ok: false, error: res.error };

  await logUserActivity(firm.id, null, "client_relationship_restored", {
    client_id: rel.from_client_id,
    related_client_id: rel.to_client_id,
    rel_type: rel.rel_type,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

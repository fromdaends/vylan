// Engagement templates (migration 1500) — a whole engagement, saved for reuse.
//
// Distinct from `templates` (migration 0001), which holds DOCUMENT REQUESTS
// only. The founder's words for why this exists: "there's templates for the
// entire engagement... it's the act of saving an entire kind of engagement",
// and of the old picker: "those templates being shown are purely for document
// collection."

import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { isMissingSchema } from "@/lib/db/quickbooks";
import {
  readPayload,
  type EngagementTemplatePayload,
} from "@/lib/engagements/template-payload";

export type EngagementTemplateAccess = "team" | "private";

export type EngagementTemplate = {
  id: string;
  name: string;
  access: EngagementTemplateAccess;
  payload: EngagementTemplatePayload;
  /** Whose it is — the picker groups private ones under their own heading. */
  createdByUserId: string | null;
  /** When it was last changed (1600). Set by trigger on every update. */
  updatedAt: string | null;
  /** Who changed it (1600). Null renders as the date with no name — honest
   *  about "we did not record who" rather than guessing. */
  updatedByUserId: string | null;
};

type Row = {
  id: string;
  name: string;
  access: string;
  payload: unknown;
  created_by_user_id: string | null;
  updated_at?: string | null;
  updated_by_user_id?: string | null;
};

/**
 * The firm's live engagement templates.
 *
 * Private ones belonging to other people are filtered by RLS, not here — a
 * private template is invisible at the database, so "private" is a guarantee
 * rather than a label. Degrades to an empty list before 1500 is applied.
 */
export async function listEngagementTemplates(): Promise<EngagementTemplate[]> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_templates")
    .select("id, name, access, payload, created_by_user_id, updated_at, updated_by_user_id")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[engagement-templates] list failed:", error);
    }
    return [];
  }

  return (data as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    access: r.access === "private" ? "private" : "team",
    payload: readPayload(r.payload),
    createdByUserId: r.created_by_user_id,
    updatedAt: r.updated_at ?? null,
    updatedByUserId: r.updated_by_user_id ?? null,
  }));
}

/**
 * One template, by id — for the edit screen.
 *
 * RLS decides whether it is visible at all: a private template belonging to
 * somebody else simply is not there, so "not found" and "not yours" are the
 * same answer and neither leaks the other's existence.
 */
export async function getEngagementTemplate(
  id: string,
): Promise<EngagementTemplate | null> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("engagement_templates")
    .select("id, name, access, payload, created_by_user_id, updated_at, updated_by_user_id")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    if (!isMissingSchema(error)) {
      console.error("[engagement-templates] get failed:", error);
    }
    return null;
  }
  if (!data) return null;

  const r = data as Row;
  return {
    id: r.id,
    name: r.name,
    access: r.access === "private" ? "private" : "team",
    payload: readPayload(r.payload),
    createdByUserId: r.created_by_user_id,
    updatedAt: r.updated_at ?? null,
    updatedByUserId: r.updated_by_user_id ?? null,
  };
}

/**
 * Save changes to one that already exists.
 *
 * Separate from create because overwriting through the create path would leave
 * the old row behind as a duplicate every time somebody fixed a typo.
 */
export async function updateEngagementTemplate(input: {
  id: string;
  name: string;
  access: EngagementTemplateAccess;
  payload: EngagementTemplatePayload;
}): Promise<{ ok: boolean; needsMigration?: boolean }> {
  const supabase = await getServerSupabase();
  const user = await getCurrentUser();
  const { error } = await supabase
    .from("engagement_templates")
    .update({
      name: input.name,
      access: input.access,
      payload: input.payload,
      // updated_at is the trigger's (1600). WHO is ours — the database cannot
      // know that. Included only when we have a user, so a service-role write
      // records the change without inventing an author.
      ...(user?.id ? { updated_by_user_id: user.id } : {}),
    })
    .eq("id", input.id);

  if (error) {
    if (isMissingSchema(error)) return { ok: false, needsMigration: true };
    console.error("[engagement-templates] update failed:", error);
    return { ok: false };
  }
  return { ok: true };
}

export async function createEngagementTemplate(input: {
  name: string;
  access: EngagementTemplateAccess;
  payload: EngagementTemplatePayload;
}): Promise<
  { ok: true; id: string } | { ok: false; needsMigration?: boolean }
> {
  const supabase = await getServerSupabase();
  const user = await getCurrentUser();
  if (!user?.firm_id) return { ok: false };

  const { data, error } = await supabase
    .from("engagement_templates")
    .insert({
      firm_id: user.firm_id,
      name: input.name,
      access: input.access,
      payload: input.payload,
      created_by_user_id: user.id,
      updated_by_user_id: user.id,
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingSchema(error)) return { ok: false, needsMigration: true };
    console.error("[engagement-templates] create failed:", error);
    return { ok: false };
  }
  return { ok: true, id: (data as { id: string }).id };
}

/**
 * Retire a template. NOT a delete — the same reasoning as the service
 * catalogue: it may be the reason a past engagement looks the way it does.
 */
export async function archiveEngagementTemplate(
  id: string,
): Promise<{ ok: boolean; needsMigration?: boolean }> {
  const supabase = await getServerSupabase();
  const { error } = await supabase
    .from("engagement_templates")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    if (isMissingSchema(error)) return { ok: false, needsMigration: true };
    console.error("[engagement-templates] archive failed:", error);
    return { ok: false };
  }
  return { ok: true };
}

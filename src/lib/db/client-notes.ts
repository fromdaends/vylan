// Attributed notes on a CLIENT (migration 1270) — "spoke to Marie, she's
// switching bookkeepers in March", "don't email info@, nobody reads it".
//
// Distinct from `clients.notes`, the single text blob that still renders on the
// overview as the client's standing description. That column is one shared box
// everybody overwrites: no author, no date, no history, and two people editing
// it in an afternoon silently lose each other's work. The founder asked for
// notes "where you can view added by the person" — that is rows, not formatting.
//
// Same plumbing as file-comments (0800): firm-scoped RLS, a denormalized
// author_name so a note stays readable after its author leaves, and live name
// resolution on read so a rename updates every past note. No UPDATE path at
// all — a note records what somebody said at a moment, and silently editable
// history is worse than none. A correction is a new note.

import { getServerSupabase } from "@/lib/supabase/server";
import { userDisplayLabel } from "@/lib/db/users";
import type { SupabaseClient } from "@supabase/supabase-js";
// The row shape and the length limit live in a PLAIN module so the composer (a
// client component) can read the limit without pulling this file — and the
// Supabase server client with it — into the browser bundle.
import { CLIENT_NOTE_MAX, type ClientNote } from "@/lib/clients/note";

export type { ClientNote };

const NOTE_SELECT =
  "id, client_id, author_user_id, author_name, body, created_at";

// Missing TABLE (PGRST205 / 42P01) or COLUMN (PGRST204 / 42703) — degrade to
// "not activated yet" rather than 500ing a whole client profile. Match on codes
// ONLY (repo rule): message text is not an API.
export function isMissingClientNotesSchema(
  err: { code?: string | null } | null | undefined,
): boolean {
  return (
    err?.code === "PGRST205" ||
    err?.code === "42P01" ||
    err?.code === "PGRST204" ||
    err?.code === "42703"
  );
}

function toNote(row: Record<string, unknown>): ClientNote {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    authorUserId: (row.author_user_id as string | null) ?? null,
    authorName: (row.author_name as string | null) ?? "",
    body: (row.body as string | null) ?? "",
    createdAt: (row.created_at as string | null) ?? "",
  };
}

// Replace each note's stored author_name with the author's CURRENT display
// name, so somebody correcting their own name fixes it on every past note —
// which is how the roster, the assignee picker and the activity log all behave.
// The stored name stays the fallback for an author who has LEFT the firm: their
// users row is no longer visible through RLS, so they aren't in the map and we
// keep whatever was captured at write time.
async function applyLiveAuthorNames(
  sb: SupabaseClient,
  notes: ClientNote[],
): Promise<ClientNote[]> {
  const ids = [
    ...new Set(notes.map((n) => n.authorUserId).filter((x): x is string => !!x)),
  ];
  if (ids.length === 0) return notes;
  const { data } = await sb
    .from("users")
    .select("id, display_name, name, email")
    .in("id", ids);
  const nameById = new Map<string, string>();
  for (const u of (data ?? []) as Array<{
    id: string;
    display_name: string | null;
    name: string;
    email: string;
  }>) {
    nameById.set(u.id, userDisplayLabel(u));
  }
  return notes.map((n) =>
    n.authorUserId && nameById.has(n.authorUserId)
      ? { ...n, authorName: nameById.get(n.authorUserId)! }
      : n,
  );
}

// One client's notes, newest first — the order the index is built for.
// Returns [] (never throws) when 1270 hasn't been applied, so a client profile
// still renders on a deployment that is ahead of its database.
export async function listClientNotes(clientId: string): Promise<ClientNote[]> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("client_notes")
    .select(NOTE_SELECT)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) {
    if (isMissingClientNotesSchema(error)) return [];
    throw error;
  }
  const notes = (data ?? []).map((r) => toNote(r as Record<string, unknown>));
  return applyLiveAuthorNames(sb, notes);
}

export type CreateClientNoteResult =
  | { ok: true; note: ClientNote }
  | { ok: false; reason: "empty" | "too_long" | "not_ready" | "failed" };

// Write a note as the signed-in user. firm_id and author_user_id are passed
// explicitly because RLS CHECKS them (author_user_id = auth.uid()) — that
// equality is the whole reason the attribution can be trusted rather than being
// a free-text claim about who wrote something.
export async function createClientNote(input: {
  firmId: string;
  clientId: string;
  authorUserId: string;
  authorName: string;
  body: string;
}): Promise<CreateClientNoteResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, reason: "empty" };
  if (body.length > CLIENT_NOTE_MAX) return { ok: false, reason: "too_long" };

  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("client_notes")
    .insert({
      firm_id: input.firmId,
      client_id: input.clientId,
      author_user_id: input.authorUserId,
      // Trimmed to the column's CHECK so a very long display name can't turn a
      // valid note into a constraint violation.
      author_name: input.authorName.slice(0, 200),
      body,
    })
    .select(NOTE_SELECT)
    .single();

  if (error) {
    if (isMissingClientNotesSchema(error)) return { ok: false, reason: "not_ready" };
    return { ok: false, reason: "failed" };
  }
  return { ok: true, note: toNote(data as Record<string, unknown>) };
}

// Delete YOUR OWN note. The author check is enforced by RLS, not here — this
// just reports whether a row actually went. A delete that matches nothing comes
// back as ok:false rather than a silent success, so the UI never removes a row
// the database kept.
export async function deleteClientNote(noteId: string): Promise<boolean> {
  const sb = await getServerSupabase();
  const { data, error } = await sb
    .from("client_notes")
    .delete()
    .eq("id", noteId)
    .select("id");
  if (error) return false;
  return (data ?? []).length > 0;
}

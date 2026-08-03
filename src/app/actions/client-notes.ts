"use server";

// Writing and removing the attributed notes on a client (migration 1270).
//
// Everything the caller could lie about is taken from the SESSION, never from
// the arguments: the firm, the author's id and the author's name. The client
// sends a body and a client id, and nothing else it could forge.

import { revalidatePath } from "next/cache";
import { createClientNote, deleteClientNote } from "@/lib/db/client-notes";
import { CLIENT_NOTE_MAX } from "@/lib/clients/note";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";

export type ClientNoteResult = {
  ok: boolean;
  // Machine-readable so the component picks its own translated sentence — an
  // English string from the server would be untranslatable in the UI.
  error?: "no_session" | "forbidden" | "empty" | "too_long" | "not_ready" | "failed";
  noteId?: string;
};

export async function addClientNoteAction(input: {
  clientId: string;
  body: string;
}): Promise<ClientNoteResult> {
  const [user, firm] = await Promise.all([getCurrentUser(), getCurrentFirm()]);
  if (!user || !firm) return { ok: false, error: "no_session" };
  // No capability check on purpose. There is no "clients.view" capability —
  // seeing a client is decided by RLS (firm scope plus the private-client
  // cascade), and the insert policy re-checks exactly that. Adding
  // `clients.manage` here would mean a teammate who may work on someone can't
  // record what they learned about them, which is a strange half-permission
  // and not what anyone asked for.
  if (!input.clientId) return { ok: false, error: "failed" };

  const body = input.body?.trim() ?? "";
  if (!body) return { ok: false, error: "empty" };
  if (body.length > CLIENT_NOTE_MAX) return { ok: false, error: "too_long" };

  const result = await createClientNote({
    firmId: firm.id,
    clientId: input.clientId,
    authorUserId: user.id,
    authorName: userDisplayLabel(user),
    body,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  // The overview renders the notes, so the server copy has to catch up or a
  // refresh would show the list without the note the user just watched appear.
  revalidatePath(`/clients/${input.clientId}`);
  return { ok: true, noteId: result.note.id };
}

export async function deleteClientNoteAction(input: {
  noteId: string;
  clientId: string;
}): Promise<ClientNoteResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "no_session" };
  if (!input.noteId) return { ok: false, error: "failed" };

  // Author-only, enforced by the RLS delete policy rather than a check here:
  // the database is the one place that cannot be talked around.
  const removed = await deleteClientNote(input.noteId);
  if (!removed) return { ok: false, error: "forbidden" };

  revalidatePath(`/clients/${input.clientId}`);
  return { ok: true };
}

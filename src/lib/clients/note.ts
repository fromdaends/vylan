// The shape and the limit of a client note, with NO server imports.
//
// Split out from lib/db/client-notes so the composer (a "use client"
// component) can count down to the same maximum the database enforces without
// dragging the Supabase server client into the browser bundle. A limit the UI
// and the CHECK constraint disagree on is just a delayed error message.

export type ClientNote = {
  id: string;
  clientId: string;
  // Null once the author's auth row is gone. authorName is what keeps the note
  // readable in that case.
  authorUserId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
};

// Matches the `char_length(body) between 1 and 4000` CHECK in migration 1270.
// Change one and you must change the other.
export const CLIENT_NOTE_MAX = 4000;

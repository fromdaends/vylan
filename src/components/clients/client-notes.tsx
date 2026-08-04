"use client";

import { useTranslations } from "next-intl";
import type { ClientNote } from "@/lib/clients/note";
import type { AppLocale } from "@/lib/format";
import { InlineCommentThread } from "@/components/engagements/inline-comment-thread";

// The firm talking to itself about a client: a running, attributed log.
// "Spoke to Marie, she's switching bookkeepers in March."
//
// THIS IS NOW THE SAME THREAD AS EVERYWHERE ELSE. It used to be its own
// composer with its own list, its own delete and no @mentions at all, and the
// founder's report was exactly that: "the option to add notes for clients exists
// but its not how the checklist commenting system worked, and it should now."
// Two boxes that both take a paragraph of text about a thing are one concept, so
// there is now one component — mentions, Enter-to-post, hover-to-delete and the
// arrival animation all behave here the way they behave on a checklist item.
//
// WHAT SURVIVED THE SWAP, deliberately:
//   * Every existing note. The thread reads file_comments and falls back to
//     client_notes while 1520 is unapplied, so notes written before this never
//     disappear — and the migration copies them across when it lands.
//   * No edit path. A note records what somebody said at a moment; a correction
//     is a new note and only its author can remove it. That was true of
//     client_notes and it is true of file_comments.
//
// WHAT CHANGED that is worth knowing: ⌘/Ctrl+Enter became plain Enter, because
// that is what every other comment box in the app does. Shift+Enter still breaks
// the line, so a three-line note is still one note.
export function ClientNotes({
  clientId,
  locale,
}: {
  clientId: string;
  // Kept for call-site compatibility: the client page still loads and passes
  // these, and the thread now fetches its own rows and resolves its own viewer.
  // Removing them from the type would break a page owned by another session.
  notes?: ClientNote[];
  viewerId?: string | null;
  locale?: AppLocale;
}) {
  const t = useTranslations("Clients");
  return (
    <InlineCommentThread
      target={{ kind: "client", clientId }}
      locale={locale}
      placeholder={t("note_placeholder")}
      emptyLabel={t("notes_empty")}
      // No quoted line: unlike a checklist item or a file, the card this sits in
      // is already titled with the client. Echoing the name back would be noise.
    />
  );
}

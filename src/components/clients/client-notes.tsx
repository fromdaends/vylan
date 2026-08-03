"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  addClientNoteAction,
  deleteClientNoteAction,
} from "@/app/actions/client-notes";
import { CLIENT_NOTE_MAX, type ClientNote } from "@/lib/clients/note";
import { formatDate, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";

// The firm talking to itself about a client: a running, attributed log.
// "Spoke to Marie, she's switching bookkeepers in March."
//
// Every note carries WHO and WHEN, which is the whole reason this exists rather
// than the single `clients.notes` blob that still sits in the About panel. The
// founder asked for notes "where you can view added by the person".
//
// There is no edit. A note records what somebody said at a moment; silently
// editable history is worse than none, so a correction is a new note and only
// the author can remove their own.
export function ClientNotes({
  clientId,
  notes: initial,
  viewerId,
  locale,
}: {
  clientId: string;
  notes: ClientNote[];
  // Who is reading. Only this person's own notes offer a delete — everyone
  // else's are read-only, and the database refuses the rest anyway.
  viewerId: string | null;
  locale: AppLocale;
}) {
  const t = useTranslations("Clients");
  const [notes, setNotes] = useState(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const body = draft.trim();
  const over = body.length > CLIENT_NOTE_MAX;

  function submit() {
    if (!body || over || pending) return;
    setError(null);
    // Cleared BEFORE the round-trip so the box is ready for the next thought.
    // Restored on failure, because losing what someone typed is the one thing
    // a notes box must never do.
    const sending = body;
    setDraft("");
    startTransition(async () => {
      const res = await addClientNoteAction({ clientId, body: sending });
      if (!res.ok) {
        setDraft(sending);
        setError(res.error ?? "failed");
        return;
      }
      // The server revalidates the page, which is what makes this durable; this
      // just puts the note on screen now instead of after the refresh lands.
      setNotes((prev) => [
        {
          id: res.noteId ?? `pending-${prev.length}`,
          clientId,
          authorUserId: viewerId,
          authorName: t("note_you"),
          body: sending,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
    });
  }

  function remove(id: string) {
    const previous = notes;
    // Optimistic: the row goes now and comes back if the server refuses.
    setNotes((prev) => prev.filter((n) => n.id !== id));
    startTransition(async () => {
      const res = await deleteClientNoteAction({ noteId: id, clientId });
      if (!res.ok) {
        setNotes(previous);
        setError(res.error ?? "failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // ⌘/Ctrl+Enter sends. Plain Enter must stay a newline — a note is
            // often three lines, and a box that fires on Enter turns the second
            // line into a second note.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("note_placeholder")}
          aria-label={t("note_placeholder")}
          rows={2}
          className="resize-y text-sm"
        />
        <div className="flex items-center justify-between gap-3">
          <p
            className={cn(
              "text-xs",
              error
                ? "text-destructive"
                : over
                  ? "text-destructive"
                  : "text-muted-foreground",
            )}
          >
            {error
              ? t(`note_error_${error}` as Parameters<typeof t>[0])
              : over
                ? t("note_too_long", { max: CLIENT_NOTE_MAX })
                : t("note_hint")}
          </p>
          {/* NOT disabled while pending — a button that disables on its own
              optimism throws the optimism away. It is disabled only when there
              is genuinely nothing valid to send. */}
          <Button size="sm" onClick={submit} disabled={!body || over}>
            {t("note_add")}
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("notes_empty")}</p>
      ) : (
        <ol className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="group flex gap-3">
              <AvatarInitials name={n.authorName || "?"} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium">
                    {n.authorName || t("note_unknown_author")}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(n.createdAt, locale, "medium")}
                  </span>
                  {/* Only your own, and only on hover or keyboard focus — a
                      permanent bin on every row makes a log look like a list of
                      mistakes. focus-within keeps it reachable without a mouse. */}
                  {viewerId && n.authorUserId === viewerId && (
                    <button
                      type="button"
                      onClick={() => remove(n.id)}
                      aria-label={t("note_delete")}
                      className="ml-auto shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                {/* whitespace-pre-wrap: people write notes in lines, and
                    collapsing them would silently reformat what they wrote. */}
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {n.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

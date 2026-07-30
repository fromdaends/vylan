"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Loader2, StickyNote } from "lucide-react";
import { addHandoffNoteAction } from "@/app/actions/engagements";
import { HANDOFF_NOTE_MAX } from "@/lib/engagements/handoff-note";

// The confirmation that replaces the reassign dialog.
//
// Reassigning used to open a modal EVERY time — a "type a note?" box in the
// way of the 90% of handoffs that need no note — while the row-menu path
// offered no note at all. Same action, two opposite behaviours: one always
// interrupts, the other never lets you leave a note.
//
// Karbon shows no dialog for a plain reassign; a modal appears only when the
// change fans out (several tasks held by the same person → "just this one, or
// all of them?"). The principle worth stealing is that the confirmation should
// be sized to the CONSEQUENCE, not attached to the act. A one-job reassign has
// no consequence to confirm.
//
// So: the assignment lands immediately, and the note becomes a small optional
// second beat living inside the toast. Founder's words — "a more subtle add a
// note that appears, that you can optionally click on, is a lot better than a
// massive screen that pops up that you have to click on."
//
// The composer opens INSIDE the toast rather than in a popover, because a toast
// is already the least intrusive surface the app has and it works identically
// from a job page and from a list row — the two places you reassign from.
function AssignedToastBody({
  engagementId,
  message,
  addNoteLabel,
  placeholder,
  saveLabel,
  savedLabel,
  onDone,
}: {
  engagementId: string;
  message: string;
  addNoteLabel: string;
  placeholder: string;
  saveLabel: string;
  savedLabel: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const save = () => {
    const clean = note.trim();
    if (!clean || pending) return;
    start(async () => {
      const res = await addHandoffNoteAction(engagementId, clean);
      if (res.ok) {
        setSaved(true);
        // Long enough to read the confirmation, short enough not to sit there.
        window.setTimeout(onDone, 1400);
      }
    });
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{message}</span>
        {!open && !saved && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StickyNote className="size-3.5" aria-hidden />
            {addNoteLabel}
          </button>
        )}
        {saved && (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="size-3.5 text-icon-emerald" aria-hidden />
            {savedLabel}
          </span>
        )}
      </div>

      {open && !saved && (
        <div className="flex items-end gap-2">
          <textarea
            autoFocus
            rows={2}
            value={note}
            maxLength={HANDOFF_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a newline — the same contract as
              // the comment composer elsewhere in the app.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                save();
              }
              // Escape abandons the note without dismissing the assignment,
              // which already happened and is not undone by this.
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder={placeholder}
            className="min-h-[2.5rem] w-full resize-none rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs outline-none focus-visible:border-foreground/25"
          />
          <button
            type="button"
            onClick={save}
            disabled={pending || note.trim() === ""}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            {saveLabel}
          </button>
        </div>
      )}
    </div>
  );
}

// Show the "assigned" confirmation, with an optional note attached to it.
//
// Deliberately NOT shown for an unassignment or a self-assign: a handoff note
// is instructions FOR the person receiving the work, and in neither case is
// there someone to instruct.
export function toastAssigned(opts: {
  engagementId: string;
  message: string;
  addNoteLabel: string;
  placeholder: string;
  saveLabel: string;
  savedLabel: string;
}) {
  toast.custom(
    (id) => (
      <div className="w-[22rem] max-w-[90vw] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
        <AssignedToastBody {...opts} onDone={() => toast.dismiss(id)} />
      </div>
    ),
    {
      // Longer than a default toast: this one is asking a question, and the
      // usual ~4s is not enough to notice "Add a note", decide, and type.
      // Sonner keeps it open while the pointer is over it anyway.
      duration: 12000,
    },
  );
}

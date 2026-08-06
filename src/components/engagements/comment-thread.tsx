"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { type AppLocale } from "@/lib/format";
import type { FileComment } from "@/lib/db/file-comments";
import {
  addFileCommentAction,
  deleteFileCommentAction,
} from "@/app/actions/file-comments";
import {
  commentKeyForFile,
  commentKeyForItem,
  commentKeyForEngagement,
  commentKeyForTask,
  commentKeyForClient,
} from "@/components/engagements/comment-keys";
import {
  useCommentThread,
  CommentList,
  CommentComposer,
} from "@/components/engagements/comment-thread-core";

type Member = { id: string; name: string };

// What a thread hangs off: an uploaded file, a checklist item, a task, a client,
// or the engagement itself.
export type CommentTarget =
  | { kind: "file"; fileId: string }
  | { kind: "item"; itemId: string }
  | { kind: "task"; taskId: string }
  | { kind: "client"; clientId: string }
  | { kind: "engagement" };

// ---------------------------------------------------------------------------
// The open-composer channel. Comment threads live INSIDE server-composed
// trees (the page passes them down as ReactNodes), while the "Add a comment"
// entries live in right-click/dropdown menus elsewhere in the tree — so the
// trigger can't reach the thread by props. A window CustomEvent keyed by
// target bridges the two, the same channel pattern the chat launcher uses
// (vylan:open-help / vylan:assistant:open).
// ---------------------------------------------------------------------------

// Exported for the engagement page's always-visible Comments card (design 2a):
// it listens for the SAME event the "..." menu and ?comment=1 dispatch, so the
// existing doors keep working with the bubble replaced by a card.
export const OPEN_EVENT = "vylan:comments:add";

// The key builders live in comment-keys.ts (a PLAIN module): the engagement
// page is a Server Component and must be able to CALL them — defined here in
// a "use client" file they'd become client references and throw at request
// time. Re-exported for the client-side consumers (menus) already importing
// them from this module.
export {
  commentKeyForFile,
  commentKeyForItem,
  commentKeyForEngagement,
  commentKeyForTask,
  commentKeyForClient,
};

// Ask the matching CommentThread to open (from a context menu item, a "..."
// menu entry, or the ?comment=1 deep link).
export function openCommentComposer(key: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { key } }));
}

function keyFor(engagementId: string, target: CommentTarget): string {
  switch (target.kind) {
    case "file":
      return commentKeyForFile(target.fileId);
    case "item":
      return commentKeyForItem(target.itemId);
    case "task":
      return commentKeyForTask(target.taskId);
    case "client":
      return commentKeyForClient(target.clientId);
    default:
      return commentKeyForEngagement(engagementId);
  }
}

// Commenting, modelled on Notion (founder spec, with reference screenshots).
//
// The row itself carries no comment furniture until there IS a comment: then a
// small bubble + count sits in the row's margin. (Notion also washes the
// commented text yellow — the founder explicitly does not want that, so the
// bubble is the only marker.) Clicking the bubble opens a floating card holding
// the thread: author, time, a quoted line of what was commented on, the body,
// and a reply box. Right-click → "Add a comment" opens the same card straight
// into the composer, so a target with no comments yet shows nothing at all
// until you ask for it.
//
// THE LIST AND COMPOSER LIVE IN comment-thread-core. This file is the POPOVER
// presentation of them; inline-comment-thread.tsx is the panel presentation.
// Both share ONE implementation of mentions, posting and deleting — the
// founder's report was precisely that commenting had drifted between surfaces,
// and two copies of this behaviour is how that happens again.
export function CommentThread({
  engagementId,
  target,
  initialComments,
  members,
  currentUserId,
  locale,
  quotedText,
}: {
  engagementId: string;
  target: CommentTarget;
  initialComments: FileComment[];
  // Active firm members the author can @mention (excluding no one here; the
  // server drops the author). id + display name.
  members: Member[];
  currentUserId: string | null;
  locale: AppLocale;
  // What the thread hangs off, echoed as the quoted line at the top of the
  // card the way Notion quotes the highlighted text (the item's label, the
  // document's name, the engagement's title).
  quotedText?: string;
}) {
  const t = useTranslations("Team");
  const [open, setOpen] = useState(false);

  const myKey = keyFor(engagementId, target);
  const me = members.find((m) => m.id === currentUserId) ?? null;

  const api = useMemo(
    () => ({
      add: async (body: string, mentions: string[]) => {
        const res = await addFileCommentAction({
          engagementId,
          uploadedFileId: target.kind === "file" ? target.fileId : null,
          requestItemId: target.kind === "item" ? target.itemId : null,
          body,
          mentions,
        });
        return res.ok
          ? ({ ok: true, comment: res.comment } as const)
          : ({ ok: false, error: res.error } as const);
      },
      remove: async (id: string) =>
        deleteFileCommentAction({ id, engagementId }),
    }),
    [engagementId, target],
  );

  const state = useCommentThread({
    initialComments,
    members,
    currentUserId,
    api,
    // Deleting the last one leaves an empty card with nothing to read — close
    // it and the target goes clean again.
    onEmptied: () => setOpen(false),
  });

  const { taRef } = state;

  // Open on demand: a menu somewhere dispatched "add a comment" for this
  // target.
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined;
      if (detail?.key === myKey) setOpen(true);
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [myKey]);

  // Land in the composer whenever the card opens — the common case is arriving
  // here to say something, and reading doesn't suffer from a focused input.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, taRef]);

  // Nothing to say and nobody asked — the target stays perfectly clean.
  if (state.comments.length === 0 && !open) return null;

  const count = state.comments.length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) state.resetComposer();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            count > 0 ? t("comment_count_label", { count }) : t("comment_title")
          }
          title={
            count > 0 ? t("comment_count_label", { count }) : t("comment_title")
          }
          className={cn(
            "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5",
            "text-[11px] font-medium text-muted-foreground transition-colors",
            "hover:bg-muted hover:text-foreground focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted",
            "data-[state=open]:text-foreground",
          )}
        >
          <MessageSquare className="size-3.5" aria-hidden />
          {count > 0 && <span className="tabular-nums">{count}</span>}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        className={cn(
          "w-[21rem] p-0 shadow-lg",
          // Subtle open/close: a quick fade + a small zoom that grows FROM the
          // bubble (Radix hands us the transform origin), plus a 4px drift off
          // the trigger's side. Same class vocabulary as the Select content so
          // the app's overlays all move alike; deliberately shorter and
          // smaller than that one — this card appears next to the cursor, and
          // anything longer reads as lag. The global reduced-motion rule
          // collapses the duration to ~0, and since these keyframes only ever
          // animate opacity/transform TOWARD the resting state, the card is
          // still fully visible when motion is off.
          "origin-(--radix-popover-content-transform-origin)",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-100",
          "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
          "data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1",
        )}
        // Radix steals focus to the card on open; we want the composer, and
        // the effect above already puts it there.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <CommentList
          state={state}
          currentUserId={currentUserId}
          locale={locale}
          quotedText={quotedText}
        />
        {/* No quote line above the composer when the thread is empty — the card
            is already anchored to what's being commented on. */}
        <CommentComposer
          state={state}
          me={me}
          placeholder={t("comment_placeholder_short")}
          className={cn("p-2.5", count > 0 && "border-t border-border/60")}
        />
      </PopoverContent>
    </Popover>
  );
}

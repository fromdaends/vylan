"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { openCommentComposer } from "@/components/engagements/comment-thread";

// Collapsible wrapper for one checklist item. The item's header (label, status,
// approve/reject controls) is server-rendered and passed as `summary`; the body
// (uploaded files + any rejection reason) is `children` and only mounts when
// open. Server components can't hold open/closed state, so this thin client
// shell owns it while everything inside stays server-rendered.
//
// Default state is decided by the caller (resolved items start collapsed so a
// long checklist reads as a calm list of headers; items that need the
// accountant's eye start open).
//
// Commenting (founder: right-click, "pure"): when `commentKey` is set,
// right-clicking the item's HEADER row offers "Add a comment", which asks the
// item's CommentThread (rendered via `commentsSlot`, under the summary — so
// comments stay visible even while the item is collapsed) to open its
// composer. The header only — the file rows inside the body carry their own
// context menus, and nesting two triggers on the same surface would fight.
export function ChecklistItemShell({
  defaultOpen,
  collapsible,
  summary,
  commentKey,
  addCommentLabel,
  commentsSlot,
  children,
}: {
  defaultOpen: boolean;
  // False when there's nothing to reveal (no files, no reason) — then we render
  // a plain row with no chevron.
  collapsible: boolean;
  summary: ReactNode;
  // Present only when commenting is available (team mode) — the thread key the
  // right-click "Add a comment" should open.
  commentKey?: string;
  // Server-translated label for that menu item (the shell owns no namespace).
  addCommentLabel?: string;
  // The item's CommentThread, rendered under the summary regardless of the
  // collapsed state.
  commentsSlot?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const header = (
    <div className="flex items-start gap-2 p-3 sm:p-3.5">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-0.5 shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>
      ) : (
        <span className="w-4 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1">{summary}</div>
    </div>
  );

  return (
    <li className="rounded-lg border border-border/60 bg-card/30 transition-colors hover:border-border">
      {commentKey && addCommentLabel ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
          <ContextMenuContent className="w-48 !animate-none">
            <ContextMenuItem onSelect={() => openCommentComposer(commentKey)}>
              <MessageSquare />
              {addCommentLabel}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        header
      )}
      {/* empty:hidden — the thread renders NOTHING when there are no comments
          and no open composer, and this wrapper's padding must vanish with it
          (otherwise every item would carry a phantom gap under its header). */}
      {commentsSlot && (
        <div className="empty:hidden px-3 pb-3 sm:px-3.5 pl-9 sm:pl-10">
          {commentsSlot}
        </div>
      )}
      {collapsible && open && children && (
        <div className={cn("space-y-2 px-3 pb-3 sm:px-3.5", "pl-9 sm:pl-10")}>
          {children}
        </div>
      )}
    </li>
  );
}

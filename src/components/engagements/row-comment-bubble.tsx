"use client";

// The comment bubble that can sit on ANY row.
//
// Founder: "you know how you can right click on an engagement to say add a
// comment? Well, you can't right click on a task to add a comment... the right
// click should be universal."
//
// WHY THE EXISTING BUBBLE COULD NOT JUST BE REUSED. CommentThread (the popover
// one) is FED its rows as props by a Server Component, and `openCommentComposer`
// only works because that thread is already mounted and listening. A task row
// has no mounted thread — the task's thread lives inside the detail panel, which
// does not exist until the panel is open. So right-clicking a task could never
// have opened anything: there was nothing there to hear the event.
//
// This one mounts on the row itself and loads its own thread the first time it
// opens, so the event always has a listener. It is the same list and the same
// composer as everywhere else (comment-thread-core) — only the feeding differs.
//
// THE COUNT IS HANDED IN, NOT FETCHED. A bubble has to know whether it has
// anything to show before anyone touches it, and forty rows each asking would be
// forty requests. The table asks once (loadCommentCountsAction) and passes each
// row its number. Rows with no comments render nothing at all, which is what
// keeps a clean list clean — the same rule the engagement page's bubble follows.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";
import type { FileComment } from "@/lib/db/file-comments";
import {
  loadCommentThreadAction,
  addCommentAction,
  deleteCommentAction,
  type CommentTargetInput,
} from "@/app/actions/comments";
import {
  useCommentThread,
  CommentList,
  CommentComposer,
  type Member,
} from "@/components/engagements/comment-thread-core";

const OPEN_EVENT = "vylan:comments:add";

export function RowCommentBubble({
  target,
  commentKey,
  initialCount = 0,
  quotedText,
  className,
}: {
  target: CommentTargetInput;
  /** The key a menu entry dispatches to open this one. Same key vocabulary as
   *  the props-fed bubble (comment-keys.ts), so both kinds of thread can live
   *  on one page without a menu having to know which it is talking to. */
  commentKey: string;
  initialCount?: number;
  quotedText?: string;
  className?: string;
}) {
  const t = useTranslations("Team");
  const locale = useLocale() as AppLocale;
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [initial, setInitial] = useState<FileComment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);

  const api = useMemo(
    () => ({
      add: async (body: string, mentions: string[]) => {
        const res = await addCommentAction({ target, body, mentions });
        return res.ok
          ? ({ ok: true, comment: res.comment } as const)
          : ({ ok: false, error: res.error } as const);
      },
      remove: async (id: string) => deleteCommentAction({ id, target }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commentKey],
  );

  const state = useCommentThread({
    initialComments: initial,
    members,
    currentUserId,
    api,
    // Unlike the engagement page's bubble, this does NOT close on the last
    // delete — you reached it from a right-click to say something, and closing
    // the card out from under you after removing a stale note is the opposite
    // of helpful. It disappears on the next render instead, once the count is
    // genuinely zero.
  });

  const { taRef } = state;

  // Open on demand from a menu entry — the channel the whole feature runs on.
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined;
      if (detail?.key === commentKey) setOpen(true);
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [commentKey]);

  // Load the thread the FIRST time it opens, never on mount. A list of forty
  // rows costs nothing until one of them is actually asked about.
  useEffect(() => {
    if (!open || loaded) return;
    let alive = true;
    void loadCommentThreadAction(target).then((data) => {
      if (!alive) return;
      setInitial(data.comments);
      setMembers(data.members);
      setCurrentUserId(data.currentUserId);
      setLegacy(data.legacy);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, commentKey]);

  // Land in the composer once the rows are in — the common case is arriving
  // here to say something.
  useEffect(() => {
    if (!open || !loaded) return;
    const frame = requestAnimationFrame(() => taRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, loaded, taRef]);

  const me = members.find((m) => m.id === currentUserId) ?? null;

  // Before the thread loads, the handed-in count is the truth; after, the live
  // list is. Without the first half the bubble would vanish the instant it
  // opened and reappear a moment later.
  const count = loaded ? state.comments.length : initialCount;

  const stop = useCallback((e: React.SyntheticEvent) => e.stopPropagation(), []);

  // Nothing to say and nobody asked — the row stays perfectly clean.
  if (count === 0 && !open) return null;

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
          // The row itself is clickable on both these tables, so every control
          // inside one has to stop the click before it opens a panel about the
          // thing you were only trying to comment on.
          onClick={stop}
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
            className,
          )}
        >
          <MessageSquare className="size-3.5" aria-hidden />
          {count > 0 && <span className="tabular-nums">{count}</span>}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        onClick={stop}
        className={cn(
          "w-[21rem] p-0 shadow-lg",
          "origin-(--radix-popover-content-transform-origin)",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-150",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:duration-100",
          "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1",
          "data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1",
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {!loaded ? (
          <div className="space-y-2 px-3 py-3" aria-hidden>
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <CommentList
            state={state}
            currentUserId={currentUserId}
            locale={locale}
            quotedText={quotedText}
          />
        )}
        <CommentComposer
          state={state}
          me={me}
          placeholder={t("comment_placeholder_short")}
          allowMentions={!legacy}
          className={cn("p-2.5", count > 0 && "border-t border-border/60")}
        />
      </PopoverContent>
    </Popover>
  );
}

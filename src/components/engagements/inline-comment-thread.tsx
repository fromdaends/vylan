"use client";

// A comment thread that stands on its own — hand it a target, it does the rest.
//
// The popover version (comment-thread.tsx) is fed its rows by the engagement
// Server Component, which is right there: that page already loads every comment
// in one query. This one is for surfaces where that is impossible or wasteful —
// a task opened in the side panel, a client's notes card — and it is what makes
// the thread a genuine drop-in. The founder's instruction was "theres a build
// going on adding a sidebar view for engagements and thats where the commenting
// thing should exist"; a component that needs four props threaded through a
// server page is not something another session can drop in, and one that needs a
// target is.
//
// It fetches on OPEN, not on page render. A task list with forty rows pays
// nothing; the one task you actually opened pays one small request.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
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

export function InlineCommentThread({
  target,
  locale: localeProp,
  quotedText,
  placeholder,
  emptyLabel,
  className,
}: {
  target: CommentTargetInput;
  /** Optional. Defaults to the active locale, so the component can be dropped
   *  into a tree that never threaded one through — which is most of them. */
  locale?: AppLocale;
  /** Echoed above the first comment — the task's title, the client's name. */
  quotedText?: string;
  /** Overrides the default composer prompt (client notes word it their way). */
  placeholder?: string;
  /** Shown when the thread is empty. */
  emptyLabel?: string;
  className?: string;
}) {
  const t = useTranslations("Team");
  const activeLocale = useLocale() as AppLocale;
  const locale = localeProp ?? activeLocale;
  const [loaded, setLoaded] = useState(false);
  const [initial, setInitial] = useState<FileComment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // True when the rows came from the pre-1510 client_notes table. Mentions are
  // hidden in that state rather than silently dropped — offering a control that
  // cannot work is worse than not offering it.
  const [legacy, setLegacy] = useState(false);

  // The target is an object literal at most call sites, so a new identity every
  // render. Key the effect on its VALUES, or this refetches forever.
  const targetKey =
    target.kind === "task" ? `task:${target.taskId}` : `client:${target.clientId}`;

  useEffect(() => {
    let alive = true;
    setLoaded(false);
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
  }, [targetKey]);

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
    // Same reasoning as the effect: rebuild only when the target really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey],
  );

  const state = useCommentThread({
    initialComments: initial,
    members,
    currentUserId,
    api,
  });

  const me = members.find((m) => m.id === currentUserId) ?? null;

  const skeleton = useCallback(
    () => (
      <div className="space-y-2 px-3 py-2.5" aria-hidden>
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
      </div>
    ),
    [],
  );

  return (
    <div className={cn("space-y-2", className)}>
      {!loaded ? (
        skeleton()
      ) : (
        <>
          <CommentList
            state={state}
            currentUserId={currentUserId}
            locale={locale}
            quotedText={quotedText}
            maxHeightClass="max-h-[22rem]"
          />
          {state.comments.length === 0 && (
            <p className="flex items-center gap-2 px-1 text-[13px] text-muted-foreground">
              <MessageSquare className="size-3.5 shrink-0" aria-hidden />
              {emptyLabel ?? t("comment_empty")}
            </p>
          )}
        </>
      )}
      <CommentComposer
        state={state}
        me={me}
        placeholder={placeholder ?? t("comment_placeholder_short")}
        allowMentions={!legacy}
      />
    </div>
  );
}

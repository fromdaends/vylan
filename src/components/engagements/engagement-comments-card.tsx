"use client";

// THE COMMENTS CARD (design 2a) — the engagement-level thread as a standing
// card in the main column, replacing the header's self-hiding bubble.
//
// Same thread, new frame: the rows and composer are comment-thread-core (the
// ONE implementation the popover, the task panel and client notes share), fed
// the server-loaded comments this page already fetches. The card also listens
// for the popover's open event, so the "..." menu's "Add a comment" and the
// worklist's ?comment=1 deep link now land in this composer instead of a
// bubble that no longer exists.

import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { MessageCircle } from "lucide-react";
import type { AppLocale } from "@/lib/format";
import type { FileComment } from "@/lib/db/file-comments";
import { addCommentAction, deleteCommentAction } from "@/app/actions/comments";
import { OPEN_EVENT } from "@/components/engagements/comment-thread";
import { commentKeyForEngagement } from "@/components/engagements/comment-keys";
import {
  useCommentThread,
  CommentList,
  CommentComposer,
  type Member,
} from "@/components/engagements/comment-thread-core";

export function EngagementCommentsCard({
  engagementId,
  initialComments,
  members,
  currentUserId,
  locale,
  quotedText,
  autoFocus,
  style,
  className,
}: {
  engagementId: string;
  initialComments: FileComment[];
  members: Member[];
  currentUserId: string | null;
  locale: AppLocale;
  quotedText: string;
  /** ?comment=1 — arrive with the composer focused. */
  autoFocus?: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  const t = useTranslations("Engagements");
  const tTeam = useTranslations("Team");

  const api = useMemo(
    () => ({
      add: async (body: string, mentions: string[]) => {
        const res = await addCommentAction({
          target: { kind: "engagement", engagementId },
          body,
          mentions,
        });
        return res.ok
          ? ({ ok: true, comment: res.comment } as const)
          : ({ ok: false, error: res.error } as const);
      },
      remove: async (id: string) =>
        deleteCommentAction({
          id,
          target: { kind: "engagement", engagementId },
        }),
    }),
    [engagementId],
  );

  const state = useCommentThread({
    initialComments,
    members,
    currentUserId,
    api,
  });
  const { taRef } = state;

  // The old bubble's doors: the "..." menu and ?comment=1 both ask for the
  // engagement-level composer by key. The card answers by focusing it.
  const myKey = commentKeyForEngagement(engagementId);
  useEffect(() => {
    function focusComposer() {
      taRef.current?.focus();
      taRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined;
      if (detail?.key === myKey) focusComposer();
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    if (autoFocus) {
      const frame = requestAnimationFrame(focusComposer);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener(OPEN_EVENT, onOpen);
      };
    }
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [myKey, autoFocus, taRef]);

  const me = members.find((m) => m.id === currentUserId) ?? null;

  return (
    <section
      className={`rounded-[14px] border border-border bg-card shadow-card ${className ?? ""}`}
      style={style}
      aria-label={t("hub_comments_title")}
    >
      <div className="flex items-center gap-2.5 px-[22px] pb-1 pt-4">
        <MessageCircle
          className="size-[17px] shrink-0 text-accent"
          aria-hidden
        />
        <h2 className="text-[15.5px] font-semibold tracking-[-0.01em]">
          {t("hub_comments_title")}
        </h2>
        <span className="text-xs font-medium text-muted-foreground">
          {t("hub_comments_team_only")}
        </span>
      </div>
      <div className="px-[22px] pb-4.5 pt-2.5">
        <CommentList
          state={state}
          currentUserId={currentUserId}
          locale={locale}
          quotedText={quotedText}
          maxHeightClass="max-h-[22rem]"
        />
        {state.comments.length === 0 && (
          <p className="pb-2 text-[13px] text-muted-foreground">
            {tTeam("comment_empty")}
          </p>
        )}
        <CommentComposer
          state={state}
          me={me}
          placeholder={tTeam("comment_placeholder")}
          className={
            state.comments.length > 0
              ? "border-t border-border/60 pt-3.5"
              : undefined
          }
        />
      </div>
    </section>
  );
}

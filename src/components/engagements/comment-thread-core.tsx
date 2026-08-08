"use client";

// THE comment thread — the list and the composer, once.
//
// Extracted from comment-thread.tsx so the popover version (a bubble in a row's
// margin, on the engagement page) and the inline version (a panel body, on a
// task and on a client) are the SAME thread rather than two that merely look
// alike. That is the cohesion rule in CLAUDE.md applied to the thing the founder
// actually complained about: "it should work act and function the same as it did
// for the commenting on what used to be checklist items". If mentions, Enter-to-
// post, delete-your-own or the arrival animation live in two files, they drift —
// and the founder's whole report was that commenting had already drifted.
//
// The two callers differ ONLY in where their rows come from and which server
// action writes them, so that is exactly what `api` abstracts. Everything else —
// the @ picker, the caret tracking, the optimistic list, the focus behaviour —
// is here and has one implementation.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowUp, AtSign, Loader2, Trash2 } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { MentionText } from "@/components/ui/mention-text";
import { cn } from "@/lib/cn";
import { formatRelative, type AppLocale } from "@/lib/format";
import type { FileComment } from "@/lib/db/file-comments";

export type Member = { id: string; name: string };

// What the thread does when someone posts or deletes. The engagement page hands
// in the file-comments actions; a task or client hands in the unified ones.
export type CommentApi = {
  add: (
    body: string,
    mentions: string[],
  ) => Promise<
    { ok: true; comment: FileComment } | { ok: false; error?: string }
  >;
  remove: (id: string) => Promise<{ ok: boolean }>;
};

// The trailing "@token" before a caret: "@" at the start or after whitespace,
// then mention characters, at the end of the string. No `g` flag, so it's
// stateless and safe to reuse across exec/test/replace.
const MENTION_TOKEN = /(^|\s)@([\p{L}\p{N}._-]*)$/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// All the thread's behaviour, with no opinion about the container it sits in.
export function useCommentThread({
  initialComments,
  members,
  currentUserId,
  api,
  onEmptied,
}: {
  initialComments: FileComment[];
  members: Member[];
  currentUserId: string | null;
  api: CommentApi;
  /** Called when the last comment is deleted (the popover closes; the inline
   *  version stays put, because its composer is the point of the panel). */
  onEmptied?: () => void;
}) {
  const t = useTranslations("Team");
  const [comments, setComments] = useState<FileComment[]>(initialComments);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Members the author picked from the @ menu, kept to resolve ids on post; a
  // pick that's since been deleted from the text is dropped at submit time.
  const [picked, setPicked] = useState<Member[]>([]);
  // The active "@query" being typed (null = menu closed).
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // The comment that just landed from THIS composer, so only that one plays the
  // arrival animation.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  // Re-seed when the thread is handed a different target's rows (the inline
  // version is reused across tasks as the panel reopens, and the self-loading
  // one starts empty then fills).
  //
  // Compared by ID, not by array identity. A Server Component hands its client
  // children a NEW array on every RSC payload, so an identity check would
  // re-seed on unrelated re-renders and could throw away a comment posted a
  // moment ago but not yet revalidated — the one thing a composer must never do.
  const seededIds = initialComments.map((c) => c.id).join(",");
  useEffect(() => {
    setComments(initialComments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seededIds]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.toLowerCase();
    return members
      .filter((m) => m.id !== currentUserId && m.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, members, currentUserId]);

  function activeMentionQuery(value: string, caret: number): string | null {
    const m = MENTION_TOKEN.exec(value.slice(0, caret));
    return m ? m[2] : null;
  }

  const onBodyChange = useCallback((value: string) => {
    setBody(value);
    const el = taRef.current;
    setMentionQuery(
      activeMentionQuery(value, el ? el.selectionStart : value.length),
    );
  }, []);

  // The caret moved (arrow keys / click) without a text change — re-evaluate so
  // the menu closes when the caret leaves an @token.
  const onCaretChange = useCallback(() => {
    const el = taRef.current;
    if (el) setMentionQuery(activeMentionQuery(el.value, el.selectionStart));
  }, []);

  const insertMentionToken = useCallback(() => {
    setBody((prev) => {
      const next = prev.length === 0 || /\s$/.test(prev) ? `${prev}@` : `${prev} @`;
      return next;
    });
    setMentionQuery("");
    requestAnimationFrame(() => taRef.current?.focus());
  }, []);

  const pickMention = useCallback((member: Member) => {
    const el = taRef.current;
    const caret = el ? el.selectionStart : 0;
    const current = el ? el.value : "";
    const before = current.slice(0, caret);
    const after = current.slice(caret);
    // Only act if the caret is genuinely at a trailing @token (guards a stale
    // open menu). A replacement FUNCTION keeps the name literal — a name with
    // "$1"/"$&" would otherwise be mangled by String.replace.
    if (!MENTION_TOKEN.test(before)) {
      setMentionQuery(null);
      return;
    }
    const replaced = before.replace(
      MENTION_TOKEN,
      (_full, p1: string) => `${p1}@${member.name} `,
    );
    setBody(replaced + after);
    setMentionQuery(null);
    setPicked((prev) =>
      prev.some((p) => p.id === member.id) ? prev : [...prev, member],
    );
    requestAnimationFrame(() => el?.focus());
  }, []);

  const resetComposer = useCallback(() => {
    setBody("");
    setPicked([]);
    setMentionQuery(null);
  }, []);

  const submit = useCallback(() => {
    const text = body.trim();
    if (!text || pending) return;
    // Resolve mentions to the picked members whose "@Name" is still in the text,
    // matched as a WHOLE token (a trailing boundary) so "@Sam" doesn't also fire
    // "Samantha", and with the name escaped. The server re-sanitizes regardless.
    const mentions = picked
      .filter((p) =>
        new RegExp(`@${escapeRegExp(p.name)}(?![\\p{L}\\p{N}._-])`, "u").test(
          body,
        ),
      )
      .map((p) => p.id);
    startTransition(async () => {
      const res = await api.add(text, mentions);
      if (res.ok) {
        setComments((prev) => [...prev, res.comment]);
        setJustAddedId(res.comment.id);
        resetComposer();
        requestAnimationFrame(() => {
          const el = listRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      } else if (res.error === "not_activated") {
        toast.error(t("comment_not_activated"));
      } else if (res.error === "empty") {
        // no-op
      } else {
        toast.error(t("comment_post_failed"));
      }
    });
  }, [api, body, pending, picked, resetComposer, t]);

  const remove = useCallback(
    (id: string) => {
      startTransition(async () => {
        const res = await api.remove(id);
        if (res.ok) {
          setComments((prev) => {
            const next = prev.filter((c) => c.id !== id);
            if (next.length === 0) onEmptied?.();
            return next;
          });
        } else toast.error(t("comment_delete_failed"));
      });
    },
    [api, onEmptied, t],
  );

  return {
    // The roster the composer picks from is the same roster the LIST needs to
    // paint a mention in that person's colour — exposed rather than re-fetched.
    members,
    comments,
    setComments,
    body,
    pending,
    taRef,
    listRef,
    mentionQuery,
    mentionMatches,
    justAddedId,
    onBodyChange,
    onCaretChange,
    insertMentionToken,
    pickMention,
    setMentionQuery,
    resetComposer,
    submit,
    remove,
  };
}

export type CommentThreadState = ReturnType<typeof useCommentThread>;

// The rendered list. `quotedText` echoes what is being commented on above the
// first comment, the way Notion quotes the highlighted text. Deliberately a
// NEUTRAL rule, not amber — the founder does not want a yellow highlight
// anywhere in this feature.
export function CommentList({
  state,
  currentUserId,
  locale,
  quotedText,
  maxHeightClass = "max-h-[15rem]",
}: {
  state: CommentThreadState;
  currentUserId: string | null;
  locale: AppLocale;
  quotedText?: string;
  maxHeightClass?: string;
}) {
  const t = useTranslations("Team");
  if (state.comments.length === 0) return null;
  return (
    <div
      ref={state.listRef}
      className={cn("overflow-y-auto [scrollbar-width:thin]", maxHeightClass)}
    >
      {state.comments.map((c, i) => (
        <article
          key={c.id}
          className={cn(
            "group px-3 py-2.5",
            i > 0 && "border-t border-border/50",
            c.id === state.justAddedId &&
              "animate-in fade-in-0 slide-in-from-bottom-1 duration-200",
          )}
        >
          <div className="flex items-center gap-2">
            <AvatarInitials name={c.authorName} size={22} />
            <span className="truncate text-[13px] font-medium">
              {c.authorName}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatRelative(c.createdAt, locale)}
            </span>
            {c.authorUserId && c.authorUserId === currentUserId && (
              <button
                type="button"
                onClick={() => state.remove(c.id)}
                disabled={state.pending}
                aria-label={t("comment_delete")}
                title={t("comment_delete")}
                className="ml-auto shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
          {i === 0 && quotedText && (
            <p className="mt-1.5 ml-[30px] line-clamp-2 border-l-2 border-border pl-2 text-[12px] leading-snug text-muted-foreground">
              {quotedText}
            </p>
          )}
          {/* Mentions in each teammate's own colour — the ONE renderer, so
              every surface that mounts this list gets it at once. `c.mentions`
              are the ids the server sanitized at write time, so only a real
              (notified) mention is painted. */}
          <MentionText
            body={c.body}
            members={state.members}
            mentioned={c.mentions}
            className="mt-1 ml-[30px] block whitespace-pre-wrap break-words text-[13px] leading-snug"
          />
        </article>
      ))}
    </div>
  );
}

// The composer. The whole row is ONE rounded field and it owns the focus ring
// (focus-within), with the avatar and buttons inside it — Notion's shape, and
// the fix for a ring that used to hug the bare textarea: globals.css rings every
// :focus-visible element from the BASE layer, so the textarea cancels it
// outright (ring-0, utilities > base) and the container draws the real one.
export function CommentComposer({
  state,
  me,
  placeholder,
  allowMentions = true,
  className,
}: {
  state: CommentThreadState;
  me: Member | null;
  placeholder: string;
  /** False for a pre-migration client note, which has nowhere to store them. */
  allowMentions?: boolean;
  className?: string;
}) {
  const t = useTranslations("Team");
  return (
    <div className={className}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border border-border/70 px-2.5 py-1.5",
          "transition-[border-color,box-shadow] duration-150",
          "focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/40",
        )}
      >
        {me && <AvatarInitials name={me.name} size={22} />}
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={state.taRef}
            value={state.body}
            onChange={(e) => state.onBodyChange(e.target.value)}
            onSelect={state.onCaretChange}
            onKeyDown={(e) => {
              // Enter posts (chat convention), Shift+Enter breaks the line.
              // Escape closes the mention menu first, the container second.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                state.submit();
              } else if (e.key === "Escape" && state.mentionQuery != null) {
                e.preventDefault();
                e.stopPropagation();
                state.setMentionQuery(null);
              }
            }}
            rows={1}
            placeholder={placeholder}
            disabled={state.pending}
            className="max-h-24 w-full resize-none bg-transparent py-1 text-[13px] leading-snug placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-0"
          />

          {allowMentions &&
            state.mentionQuery != null &&
            state.mentionMatches.length > 0 && (
              <div className="absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-popover shadow-md">
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("mention_section_people")}
                </p>
                <ul className="pb-1">
                  {state.mentionMatches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        // pointerdown fires before the textarea's blur, so the
                        // pick never lands after focus has moved away.
                        onPointerDown={(e) => {
                          e.preventDefault();
                          state.pickMention(m);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-secondary"
                      >
                        <AvatarInitials name={m.name} size={20} />
                        <span className="truncate">{m.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {allowMentions && (
            <button
              type="button"
              onClick={state.insertMentionToken}
              disabled={state.pending}
              aria-label={t("mention_insert")}
              title={t("mention_insert")}
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <AtSign className="size-3.5" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={state.submit}
            disabled={state.pending || state.body.trim().length === 0}
            aria-label={t("comment_post")}
            title={t("comment_post")}
            className={cn(
              // The colour shift as it goes live is the cue that Enter will
              // send; the press scale is the only movement it makes.
              "inline-flex size-6 items-center justify-center rounded-full",
              "transition-[background-color,color,transform] duration-150 active:scale-90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              state.body.trim().length === 0 || state.pending
                ? "bg-muted text-muted-foreground"
                : "cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {state.pending ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="size-3.5" aria-hidden />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

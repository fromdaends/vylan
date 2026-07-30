"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowUp, AtSign, Loader2, MessageSquare, Trash2 } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { formatRelative, type AppLocale } from "@/lib/format";
import type { FileComment } from "@/lib/db/file-comments";
import {
  addFileCommentAction,
  deleteFileCommentAction,
} from "@/app/actions/file-comments";
import {
  commentKeyForFile,
  commentKeyForItem,
  commentKeyForEngagement,
} from "@/components/engagements/comment-keys";

type Member = { id: string; name: string };

// What a thread hangs off: an uploaded file, a checklist item, or the
// engagement itself.
export type CommentTarget =
  | { kind: "file"; fileId: string }
  | { kind: "item"; itemId: string }
  | { kind: "engagement" };

// ---------------------------------------------------------------------------
// The open-composer channel. Comment threads live INSIDE server-composed
// trees (the page passes them down as ReactNodes), while the "Add a comment"
// entries live in right-click/dropdown menus elsewhere in the tree — so the
// trigger can't reach the thread by props. A window CustomEvent keyed by
// target bridges the two, the same channel pattern the chat launcher uses
// (vylan:open-help / vylan:assistant:open).
// ---------------------------------------------------------------------------

const OPEN_EVENT = "vylan:comments:add";

// The key builders live in comment-keys.ts (a PLAIN module): the engagement
// page is a Server Component and must be able to CALL them — defined here in
// a "use client" file they'd become client references and throw at request
// time. Re-exported for the client-side consumers (menus) already importing
// them from this module.
export { commentKeyForFile, commentKeyForItem, commentKeyForEngagement };

// Ask the matching CommentThread to open (from a context menu item, a "..."
// menu entry, or the ?comment=1 deep link).
export function openCommentComposer(key: string) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { key } }));
}

function keyFor(engagementId: string, target: CommentTarget): string {
  return target.kind === "file"
    ? commentKeyForFile(target.fileId)
    : target.kind === "item"
      ? commentKeyForItem(target.itemId)
      : commentKeyForEngagement(engagementId);
}

// The trailing "@token" before a caret: "@" at the start or after whitespace,
// then mention characters, at the end of the string. No `g` flag, so it's
// stateless and safe to reuse across exec/test/replace.
const MENTION_TOKEN = /(^|\s)@([\p{L}\p{N}._-]*)$/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const [comments, setComments] = useState<FileComment[]>(initialComments);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Members the author picked from the @ menu, kept to resolve ids on post; a
  // pick that's since been deleted from the text is dropped at submit time.
  const [picked, setPicked] = useState<Member[]>([]);
  // The active "@query" being typed (null = menu closed).
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  // The comment that just landed from THIS composer, so only that one plays
  // the arrival animation — replaying it for the whole thread every time the
  // card opens would be noise on top of the card's own entrance.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const myKey = keyFor(engagementId, target);
  const me = members.find((m) => m.id === currentUserId) ?? null;

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
  }, [open]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.toLowerCase();
    return members
      .filter((m) => m.id !== currentUserId && m.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, members, currentUserId]);

  // The active "@token" immediately before the caret (the word being typed after
  // an "@"), or null when the caret isn't in one.
  function activeMentionQuery(value: string, caret: number): string | null {
    const m = MENTION_TOKEN.exec(value.slice(0, caret));
    return m ? m[2] : null;
  }
  function onBodyChange(value: string) {
    setBody(value);
    const el = taRef.current;
    setMentionQuery(
      activeMentionQuery(value, el ? el.selectionStart : value.length),
    );
  }
  // The caret moved (arrow keys / click) without a text change — re-evaluate so
  // the menu closes when the caret leaves an @token, instead of a later pick
  // replacing the wrong spot.
  function onCaretChange() {
    const el = taRef.current;
    if (el) setMentionQuery(activeMentionQuery(body, el.selectionStart));
  }

  // The @ button: same as typing one, so the picker has a discoverable handle
  // (Notion puts it right next to the send arrow).
  function insertMentionToken() {
    const next = body.length === 0 || /\s$/.test(body) ? `${body}@` : `${body} @`;
    setBody(next);
    setMentionQuery("");
    requestAnimationFrame(() => taRef.current?.focus());
  }

  function pickMention(member: Member) {
    const el = taRef.current;
    const caret = el ? el.selectionStart : body.length;
    const before = body.slice(0, caret);
    const after = body.slice(caret);
    // Only act if the caret is genuinely at a trailing @token (guards a stale
    // open menu). A replacement FUNCTION keeps the name literal — a name with
    // "$1"/"$&" etc. would otherwise be mangled by String.replace.
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
    // Return focus to the textarea after the menu closes.
    requestAnimationFrame(() => el?.focus());
  }

  const resetComposer = useCallback(() => {
    setBody("");
    setPicked([]);
    setMentionQuery(null);
  }, []);

  function submit() {
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
      const res = await addFileCommentAction({
        engagementId,
        uploadedFileId: target.kind === "file" ? target.fileId : null,
        requestItemId: target.kind === "item" ? target.itemId : null,
        body: text,
        mentions,
      });
      if (res.ok) {
        setComments((prev) => [...prev, res.comment]);
        setJustAddedId(res.comment.id);
        resetComposer();
        // Stay open — Notion keeps the thread up after a reply so you can see
        // what you just wrote land. Ride it into view when the thread has
        // outgrown the card.
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
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteFileCommentAction({ id, engagementId });
      if (res.ok) {
        setComments((prev) => {
          const next = prev.filter((c) => c.id !== id);
          // Deleting the last one leaves an empty card with nothing to read —
          // close it and the target goes clean again.
          if (next.length === 0) setOpen(false);
          return next;
        });
      } else toast.error(t("comment_delete_failed"));
    });
  }

  // Nothing to say and nobody asked — the target stays perfectly clean.
  if (comments.length === 0 && !open) return null;

  const count = comments.length;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetComposer();
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
        {count > 0 && (
          <div
            ref={listRef}
            className="max-h-[15rem] overflow-y-auto [scrollbar-width:thin]"
          >
            {comments.map((c, i) => (
              <article
                key={c.id}
                className={cn(
                  "group px-3 py-2.5",
                  i > 0 && "border-t border-border/50",
                  // Just posted: a short fade + 4px rise so the reply reads as
                  // arriving rather than blinking into the list.
                  c.id === justAddedId &&
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
                      onClick={() => remove(c.id)}
                      disabled={pending}
                      aria-label={t("comment_delete")}
                      title={t("comment_delete")}
                      className="ml-auto shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  )}
                </div>
                {/* The quoted target, once, above the first comment — Notion's
                    echo of what was commented on. Deliberately a NEUTRAL rule,
                    not amber: the founder does not want a yellow highlight
                    anywhere in this feature. */}
                {i === 0 && quotedText && (
                  <p className="mt-1.5 ml-[30px] line-clamp-2 border-l-2 border-border pl-2 text-[12px] leading-snug text-muted-foreground">
                    {quotedText}
                  </p>
                )}
                <p className="mt-1 ml-[30px] whitespace-pre-wrap break-words text-[13px] leading-snug">
                  {c.body}
                </p>
              </article>
            ))}
          </div>
        )}

        {/* Composer */}
        <div
          className={cn(
            "flex items-start gap-2 p-2.5",
            count > 0 && "border-t border-border/60",
          )}
        >
          {me && <AvatarInitials name={me.name} size={22} />}
          <div className="relative min-w-0 flex-1">
            {/* No quote line above the composer when the thread is empty — the
                card is already anchored to the thing being commented on. */}
            <textarea
              ref={taRef}
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              onSelect={onCaretChange}
              onKeyDown={(e) => {
                // Enter posts (chat convention), Shift+Enter breaks the line.
                // Escape closes the mention menu first, the card second.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape" && mentionQuery != null) {
                  e.preventDefault();
                  e.stopPropagation();
                  setMentionQuery(null);
                }
              }}
              rows={1}
              placeholder={t("comment_placeholder_short")}
              disabled={pending}
              className="max-h-24 w-full resize-none bg-transparent py-1 text-[13px] leading-snug placeholder:text-muted-foreground/70 focus-visible:outline-none"
            />

            {mentionQuery != null && mentionMatches.length > 0 && (
              <div className="absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-popover shadow-md">
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("mention_section_people")}
                </p>
                <ul className="pb-1">
                  {mentionMatches.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        // pointerdown fires before the textarea's blur, so the
                        // pick never lands after focus has moved away.
                        onPointerDown={(e) => {
                          e.preventDefault();
                          pickMention(m);
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

          <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
            <button
              type="button"
              onClick={insertMentionToken}
              disabled={pending}
              aria-label={t("mention_insert")}
              title={t("mention_insert")}
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <AtSign className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || body.trim().length === 0}
              aria-label={t("comment_post")}
              title={t("comment_post")}
              className={cn(
                // The colour shift as it goes live is the cue that Enter will
                // send; the press scale is the only movement it makes.
                "inline-flex size-6 items-center justify-center rounded-full",
                "transition-[background-color,color,transform] duration-150 active:scale-90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                body.trim().length === 0 || pending
                  ? "bg-muted text-muted-foreground"
                  : "cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90",
              )}
            >
              {pending ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <ArrowUp className="size-3.5" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

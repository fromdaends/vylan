"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Send, Trash2 } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { cn } from "@/lib/cn";
import { formatRelative, type AppLocale } from "@/lib/format";
import type { FileComment } from "@/lib/db/file-comments";
import {
  addFileCommentAction,
  deleteFileCommentAction,
} from "@/app/actions/file-comments";

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

export function commentKeyForFile(fileId: string): string {
  return `file:${fileId}`;
}
export function commentKeyForItem(itemId: string): string {
  return `item:${itemId}`;
}
export function commentKeyForEngagement(engagementId: string): string {
  return `eng:${engagementId}`;
}

// Ask the matching CommentThread to open its composer (from a context menu
// item, a "..." menu entry, or the ?comment=1 deep link).
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

// "Pure" commenting (founder): no panel, no header, no always-on input. The
// thread renders as bare comment lines under its target — nothing at all when
// empty — and the composer only exists after a right-click "Add a comment"
// (or "..." menu / deep link) asks for it, then goes away again on post/Esc/
// empty blur. @mentions kept from the original file-comments composer.
export function CommentThread({
  engagementId,
  target,
  initialComments,
  members,
  currentUserId,
  locale,
}: {
  engagementId: string;
  target: CommentTarget;
  initialComments: FileComment[];
  // Active firm members the author can @mention (excluding no one here; the
  // server drops the author). id + display name.
  members: Member[];
  currentUserId: string | null;
  locale: AppLocale;
}) {
  const t = useTranslations("Team");
  const [comments, setComments] = useState<FileComment[]>(initialComments);
  const [composerOpen, setComposerOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Members the author picked from the @ menu, kept to resolve ids on post; a
  // pick that's since been deleted from the text is dropped at submit time.
  const [picked, setPicked] = useState<Member[]>([]);
  // The active "@query" being typed (null = menu closed).
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const myKey = keyFor(engagementId, target);
  const me = members.find((m) => m.id === currentUserId) ?? null;

  // Open on demand: a menu somewhere dispatched "add a comment" for this
  // target.
  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined;
      if (detail?.key === myKey) setComposerOpen(true);
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [myKey]);

  // Focus the input the moment it appears (also after re-opens).
  useEffect(() => {
    if (composerOpen) taRef.current?.focus();
  }, [composerOpen]);

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
    const next = replaced + after;
    setBody(next);
    setMentionQuery(null);
    setPicked((prev) =>
      prev.some((p) => p.id === member.id) ? prev : [...prev, member],
    );
    // Return focus to the textarea after the menu closes.
    requestAnimationFrame(() => el?.focus());
  }

  function closeComposer() {
    setComposerOpen(false);
    setBody("");
    setPicked([]);
    setMentionQuery(null);
  }

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
        closeComposer();
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
      if (res.ok) setComments((prev) => prev.filter((c) => c.id !== id));
      else toast.error(t("comment_delete_failed"));
    });
  }

  // Nothing to say and nobody asked — the target stays perfectly clean.
  if (comments.length === 0 && !composerOpen) return null;

  return (
    <div className="mt-1.5 space-y-2">
      {comments.length > 0 && (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="group flex gap-2">
              <AvatarInitials name={c.authorName} size={22} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">{c.authorName}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatRelative(c.createdAt, locale)}
                  </span>
                  {c.authorUserId && c.authorUserId === currentUserId && (
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      disabled={pending}
                      aria-label={t("comment_delete")}
                      title={t("comment_delete")}
                      className="ml-auto text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap break-words text-[13px] leading-snug">
                  {c.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {composerOpen && (
        <div className="relative flex items-start gap-2">
          {me && <AvatarInitials name={me.name} size={22} />}
          <div className="relative min-w-0 flex-1">
            <textarea
              ref={taRef}
              value={body}
              onChange={(e) => onBodyChange(e.target.value)}
              onSelect={onCaretChange}
              onKeyDown={(e) => {
                // Enter posts (chat convention), Shift+Enter breaks the line,
                // Esc walks away.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  closeComposer();
                }
              }}
              onBlur={() => {
                // Left without writing anything → the composer quietly goes
                // away again.
                if (body.trim().length === 0 && mentionQuery == null) {
                  closeComposer();
                }
              }}
              rows={1}
              placeholder={t("comment_placeholder")}
              disabled={pending}
              className="w-full resize-none border-b border-border/60 bg-transparent pb-1 pt-0.5 text-[13px] leading-snug placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:outline-none"
            />

            {mentionQuery != null && mentionMatches.length > 0 && (
              <ul className="absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-md border border-border bg-popover shadow-md">
                {mentionMatches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      // pointerdown fires before the textarea's blur, so a
                      // pick with an empty body never closes the composer
                      // out from under the click.
                      onPointerDown={(e) => {
                        e.preventDefault();
                        pickMention(m);
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-secondary"
                    >
                      <AvatarInitials name={m.name} size={20} />
                      <span className="truncate">{m.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={pending || body.trim().length === 0}
            aria-label={t("comment_post")}
            title={t("comment_post")}
            className={cn(
              "mt-0.5 shrink-0 rounded-full p-1 text-muted-foreground transition-colors",
              "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

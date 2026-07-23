"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Send, Trash2, MessageSquare } from "lucide-react";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { formatRelative, type AppLocale } from "@/lib/format";
import type { FileComment } from "@/lib/db/file-comments";
import {
  addFileCommentAction,
  deleteFileCommentAction,
} from "@/app/actions/file-comments";

type Member = { id: string; name: string };

// The trailing "@token" before a caret: "@" at the start or after whitespace,
// then mention characters, at the end of the string. No `g` flag, so it's
// stateless and safe to reuse across exec/test/replace.
const MENTION_TOKEN = /(^|\s)@([\p{L}\p{N}._-]*)$/u;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Team Wave 3 — the comment thread + @mention composer on one uploaded file.
// Firm-internal (the client never sees it). Comments post to a file; typing "@"
// opens a member picker whose pick both inserts "@Name " and records the id to
// notify. The server re-sanitizes the ids, so the tracked set is just a hint.
export function FileComments({
  fileId,
  engagementId,
  initialComments,
  members,
  currentUserId,
  locale,
}: {
  fileId: string;
  engagementId: string;
  initialComments: FileComment[];
  // Active firm members the author can @mention (excluding no one here; the
  // server drops the author). id + display name.
  members: Member[];
  currentUserId: string | null;
  locale: AppLocale;
}) {
  const t = useTranslations("Team");
  const [comments, setComments] = useState<FileComment[]>(initialComments);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Members the author picked from the @ menu, kept to resolve ids on post; a
  // pick that's since been deleted from the text is dropped at submit time.
  const [picked, setPicked] = useState<Member[]>([]);
  // The active "@query" being typed (null = menu closed).
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

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
        uploadedFileId: fileId,
        body: text,
        mentions,
      });
      if (res.ok) {
        setComments((prev) => [...prev, res.comment]);
        setBody("");
        setPicked([]);
        setMentionQuery(null);
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

  return (
    <div className="mt-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <MessageSquare className="h-3 w-3" aria-hidden />
        {t("comment_title")}
      </div>

      {comments.length > 0 && (
        <ul className="mb-2 space-y-2.5">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2">
              <AvatarInitials name={c.authorName} size={24} />
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
                      className="ml-auto text-muted-foreground hover:text-destructive"
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

      <div className="relative">
        <textarea
          ref={taRef}
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          onSelect={onCaretChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={t("comment_placeholder")}
          disabled={pending}
          className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {mentionQuery != null && mentionMatches.length > 0 && (
          <ul className="absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-md border border-border bg-popover shadow-md">
            {mentionMatches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => pickMention(m)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-secondary"
                >
                  <AvatarInitials name={m.name} size={20} />
                  <span className="truncate">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-1.5 flex items-center justify-end">
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={pending || body.trim().length === 0}
            className="h-7 gap-1.5 text-xs"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden />
            )}
            {t("comment_post")}
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

// Team group chat — the firm-wide, internal, human↔human thread. A light
// generalization of EngagementMessages: instead of the firm/client binary,
// bubbles are keyed to the AUTHOR (mine = my user id), every bubble shows the
// sender's name + a deterministic avatar tint, and there's no client banner or
// "Seen" marker (this is team-only). Near-live via the same visibility-gated 4s
// poll used everywhere else in the app (no realtime infra in this codebase).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { cn } from "@/lib/cn";
import type { TeamMessageRow } from "@/lib/db/team-messages";

const MAX_LENGTH = 4000;
const POLL_MS = 4_000;

// Deterministic per-author avatar tint so each teammate is visually distinct.
const AVATAR_COLORS = [
  "#0f766e",
  "#7c3aed",
  "#b45309",
  "#be123c",
  "#1d4ed8",
  "#4d7c0f",
  "#0369a1",
  "#9333ea",
];
function colorFor(id: string | null): string {
  if (!id) return "#475569";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] as string;
}

export function TeamChat({
  currentUserId,
  initialMessages,
  initialLastReadAt = null,
  notActivated,
  locale,
}: {
  currentUserId: string;
  initialMessages: TeamMessageRow[];
  initialLastReadAt?: string | null;
  // Migration 0870 not applied yet — show the quiet gated state.
  notActivated: boolean;
  locale: "fr" | "en";
}) {
  const t = useTranslations("TeamChat");
  const [messages, setMessages] = useState<TeamMessageRow[]>(initialMessages);
  const [loadedOnce, setLoadedOnce] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(false);
  // The newest message from SOMEONE ELSE we've already stamped read, so polls
  // only re-stamp when something genuinely new arrives.
  const lastReadOtherAtRef = useRef<string | null>(initialLastReadAt);

  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  const newestFromOthers = useCallback(
    (list: TeamMessageRow[]) => {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]!.sender_user_id !== currentUserId) return list[i]!.created_at;
      }
      return null;
    },
    [currentUserId],
  );

  const markRead = useCallback(() => {
    fetch(`/api/team/messages/read`, { method: "POST" }).catch(
      () => undefined,
    );
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/team/messages`);
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: TeamMessageRow[] };
      if (!Array.isArray(data.messages)) return;
      setMessages(data.messages);
      setLoadedOnce(true);
      const newest = newestFromOthers(data.messages);
      if (visibleRef.current && newest && newest !== lastReadOtherAtRef.current) {
        lastReadOtherAtRef.current = newest;
        markRead();
      }
    } catch {
      // Background refresh only — never surface an error.
    }
  }, [markRead, newestFromOthers]);

  useEffect(() => {
    if (notActivated) return;
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      const wasVisible = visibleRef.current;
      visibleRef.current = visible;
      if (visible && !wasVisible) {
        lastReadOtherAtRef.current = newestFromOthers(messages);
        markRead();
        refresh();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notActivated]);

  useEffect(() => {
    if (notActivated) return;
    const timer = setInterval(() => {
      if (visibleRef.current && document.visibilityState === "visible") {
        refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [notActivated, refresh]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(false);
    try {
      const res = await fetch(`/api/team/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: TeamMessageRow;
      } | null;
      if (!res.ok || !data?.ok || !data.message) {
        setSendError(true);
        return;
      }
      const sent = data.message;
      setMessages((prev) =>
        prev.some((m) => m.id === sent.id) ? prev : [...prev, sent],
      );
      setDraft("");
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }

  if (notActivated) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {t("not_activated")}
      </div>
    );
  }

  const remaining = MAX_LENGTH - draft.length;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-2.5">
        <p className="text-[13px] font-semibold leading-tight text-foreground">
          {t("thread_title")}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {t("team_only")}
        </p>
      </div>

      <div
        ref={listRef}
        className="flex-1 min-h-0 space-y-3 overflow-y-auto px-4 py-4 [scrollbar-width:thin]"
      >
        {messages.length === 0 && !loadedOnce ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-sm font-medium text-foreground">
              {t("empty_title")}
            </p>
            <p className="text-sm text-muted-foreground">{t("empty_body")}</p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_user_id === currentUserId;
            return (
              <div
                key={m.id}
                className={cn(
                  "flex items-end gap-2",
                  mine ? "flex-row-reverse" : "flex-row",
                )}
              >
                <AvatarInitials
                  name={m.sender_name}
                  size={28}
                  color={mine ? "#475569" : colorFor(m.sender_user_id)}
                />
                <div
                  className={cn(
                    "max-w-[75%] space-y-1",
                    mine ? "items-end text-right" : "items-start text-left",
                  )}
                >
                  <div
                    className={cn(
                      "inline-block whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-left text-sm",
                      mine
                        ? "rounded-br-sm bg-primary text-primary-foreground"
                        : "rounded-bl-sm bg-muted text-foreground",
                    )}
                  >
                    {m.body}
                  </div>
                  <p className="text-[11px] leading-none text-muted-foreground">
                    {m.sender_name} ·{" "}
                    <time dateTime={m.created_at}>
                      {timeFormat.format(new Date(m.created_at))}
                    </time>
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0 border-t border-border px-4 pt-3 pb-4">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value.slice(0, MAX_LENGTH));
              setSendError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={t("placeholder")}
            rows={1}
            className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-2xl"
            aria-label={t("placeholder")}
          />
          <Button
            type="button"
            onClick={handleSend}
            disabled={sending || draft.trim().length === 0}
            className="shrink-0 rounded-full"
          >
            <Send className="size-4" aria-hidden />
            {sending ? t("sending") : t("send")}
          </Button>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
          <p
            className={cn("text-xs text-destructive", !sendError && "invisible")}
            role={sendError ? "alert" : undefined}
          >
            {t("send_failed")}
          </p>
          {remaining <= 500 && (
            <p className="text-xs text-muted-foreground">
              {t("chars_left", { count: remaining })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

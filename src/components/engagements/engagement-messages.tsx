"use client";

// Client messaging (Phase 1) — the HUMAN accountant<->client thread, shown as
// its own tab on the engagement page. Deliberately unmistakable from the AI
// assistant panel: different place (in-page tab, not the right-edge panel),
// different name ("Messages with {client}"), and human-to-human styling
// (sender names + initials on every message, a "your client receives these
// messages" caption, no AI iconography anywhere).
//
// Comment-thread cadence, not live chat (founder call): loads with the page,
// refreshes every 60s only while the tab is actually visible, and appends
// your own message on send. Opening the tab stamps the firm's read pointer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { cn } from "@/lib/cn";
import type { ClientMessageRow } from "@/lib/db/client-messages";

// UI-side mirror of the server/DB cap (CLIENT_MESSAGE_MAX_LENGTH).
const MAX_LENGTH = 4000;
// Refresh cadence while the tab is visible. Comment threads, not live chat.
const POLL_MS = 60_000;

export function EngagementMessages({
  engagementId,
  clientName,
  initialMessages,
  initialClientLastReadAt = null,
  notActivated,
  readOnly,
  readOnlyReason,
  locale,
  deferInitialLoad = false,
}: {
  engagementId: string;
  clientName: string | null;
  initialMessages: ClientMessageRow[];
  // When the CLIENT last opened the thread — powers the accountant-side-only
  // "Seen" marker under the firm's latest message. Never shown to clients.
  initialClientLastReadAt?: string | null;
  // Migration 0650 not applied yet — show the quiet gated state.
  notActivated: boolean;
  readOnly: boolean;
  readOnlyReason: "complete" | "cancelled" | "draft" | null;
  locale: "fr" | "en";
  // Panel hosting: no server-rendered messages were passed, the component
  // fetches on first visibility — show a quiet loading state until then
  // instead of a misleading "no messages yet".
  deferInitialLoad?: boolean;
}) {
  const t = useTranslations("ClientMessages");
  const [messages, setMessages] = useState<ClientMessageRow[]>(initialMessages);
  const [loadedOnce, setLoadedOnce] = useState(!deferInitialLoad);
  const [clientLastReadAt, setClientLastReadAt] = useState<string | null>(
    initialClientLastReadAt,
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(false);
  // The newest client message we've already stamped as read, so polls only
  // re-stamp when something actually new arrived.
  const lastReadClientAtRef = useRef<string | null>(null);

  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  const newestClientAt = useCallback((list: ClientMessageRow[]) => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.sender === "client") return list[i]!.created_at;
    }
    return null;
  }, []);

  const markRead = useCallback(() => {
    // Fire-and-forget; the badge was already cleared visually by the tab.
    fetch(`/api/engagements/${engagementId}/messages/read`, {
      method: "POST",
    }).catch(() => undefined);
  }, [engagementId]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/messages`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages?: ClientMessageRow[];
        clientLastReadAt?: string | null;
      };
      if (!Array.isArray(data.messages)) return;
      setMessages(data.messages);
      setClientLastReadAt(data.clientLastReadAt ?? null);
      setLoadedOnce(true);
      // A new client message arrived while the thread is open: stamp it read
      // so the unread badge doesn't reappear on the next page load.
      const newest = newestClientAt(data.messages);
      if (
        visibleRef.current &&
        newest &&
        newest !== lastReadClientAtRef.current
      ) {
        lastReadClientAtRef.current = newest;
        markRead();
      }
    } catch {
      // Background refresh only — never surface an error for it.
    }
  }, [engagementId, markRead, newestClientAt]);

  // Visibility tracking: the tab switcher keeps this mounted but hidden, so
  // "the accountant opened the tab" = the root actually intersecting the
  // viewport. First sight stamps the read pointer and starts the slow poll.
  useEffect(() => {
    if (notActivated) return;
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      const wasVisible = visibleRef.current;
      visibleRef.current = visible;
      if (visible && !wasVisible) {
        lastReadClientAtRef.current = newestClientAt(messages);
        markRead();
        refresh();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
    // Deliberately NOT keyed on `messages`: the observer only needs to exist
    // once; the refs carry current state into its callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notActivated, engagementId]);

  useEffect(() => {
    if (notActivated) return;
    const timer = setInterval(() => {
      if (visibleRef.current && document.visibilityState === "visible") {
        refresh();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [notActivated, refresh]);

  // Keep the list pinned to the newest message.
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
      const res = await fetch(`/api/engagements/${engagementId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: ClientMessageRow;
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

  // The accountant-side "Seen" marker sits under the firm's LATEST message,
  // and only once the client's read pointer has passed it.
  const lastFirmMessage = [...messages]
    .reverse()
    .find((m) => m.sender === "firm");
  const lastFirmSeen =
    lastFirmMessage != null &&
    clientLastReadAt != null &&
    new Date(clientLastReadAt).getTime() >=
      new Date(lastFirmMessage.created_at).getTime();

  const placeholder = clientName
    ? t("placeholder", { name: clientName })
    : t("placeholder_generic");

  // Full-height chat: a slim human banner up top, the thread filling every
  // pixel of space (no bordered box, no dead area), and the composer docked
  // at the bottom — an actual messaging surface, not a widget in a card. The
  // human cues (banner "goes to your client", avatars + names on every
  // bubble, "Seen") keep it unmistakable from the AI chat next door.
  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      {/* Slim banner — the standing reminder that this is the CLIENT, not the
          AI. This is the surface's identity line. */}
      <div className="shrink-0 border-b border-border px-4 py-2.5">
        <p className="text-[13px] font-semibold leading-tight text-foreground">
          {clientName
            ? t("thread_with", { name: clientName })
            : t("thread_title")}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {t("client_receives")}
        </p>
      </div>

      {/* The conversation — fills all remaining height and scrolls on its own. */}
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
            <p className="text-sm text-muted-foreground">
              {clientName
                ? t("empty_body", { name: clientName })
                : t("empty_body_generic")}
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender === "firm";
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
                  color={mine ? "#475569" : "#0f766e"}
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
                    {lastFirmSeen && m.id === lastFirmMessage?.id && (
                      <span className="ml-1.5 font-medium text-muted-foreground/90">
                        · {t("seen")}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Docked composer (or the read-only note on a closed engagement). */}
      {readOnly ? (
        <div className="shrink-0 border-t border-border px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {readOnlyReason === "cancelled"
              ? t("read_only_cancelled")
              : readOnlyReason === "draft"
                ? t("read_only_draft")
                : t("read_only_complete")}
          </p>
        </div>
      ) : (
        <div className="shrink-0 border-t border-border px-4 pt-3 pb-4">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value.slice(0, MAX_LENGTH));
                setSendError(false);
              }}
              placeholder={placeholder}
              rows={1}
              className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-2xl"
              aria-label={placeholder}
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
              className={cn(
                "text-xs text-destructive",
                !sendError && "invisible",
              )}
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
      )}
    </div>
  );
}

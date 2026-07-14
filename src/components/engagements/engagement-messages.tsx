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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  readOnlyReason: "complete" | "cancelled" | null;
  locale: "fr" | "en";
}) {
  const t = useTranslations("ClientMessages");
  const [messages, setMessages] = useState<ClientMessageRow[]>(initialMessages);
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
      // A new client message arrived while the thread is open: stamp it read
      // so the unread badge doesn't reappear on the next page load.
      const newest = newestClientAt(data.messages);
      if (visibleRef.current && newest && newest !== lastReadClientAtRef.current) {
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
      <div className="py-4 text-sm text-muted-foreground">
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

  return (
    <div ref={rootRef} className="space-y-3">
      {/* Human-to-human header: the client's name front and center, so this
          surface can never be mistaken for the AI assistant. */}
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold text-foreground">
          {clientName
            ? t("thread_with", { name: clientName })
            : t("thread_title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("client_receives")}</p>
      </div>

      {messages.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {t("empty_title")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {clientName
              ? t("empty_body", { name: clientName })
              : t("empty_body_generic")}
          </p>
        </div>
      ) : (
        <div
          ref={listRef}
          className="max-h-[28rem] space-y-3 overflow-y-auto rounded-lg border border-border bg-card p-3"
        >
          {messages.map((m) => {
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
          })}
        </div>
      )}

      {readOnly ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          {readOnlyReason === "cancelled"
            ? t("read_only_cancelled")
            : t("read_only_complete")}
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value.slice(0, MAX_LENGTH));
                setSendError(false);
              }}
              placeholder={
                clientName
                  ? t("placeholder", { name: clientName })
                  : t("placeholder_generic")
              }
              rows={2}
              className="min-h-[3.25rem] flex-1 resize-y"
              aria-label={
                clientName
                  ? t("placeholder", { name: clientName })
                  : t("placeholder_generic")
              }
            />
            <Button
              type="button"
              onClick={handleSend}
              disabled={sending || draft.trim().length === 0}
              className="shrink-0"
            >
              <Send className="size-4" aria-hidden />
              {sending ? t("sending") : t("send")}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
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

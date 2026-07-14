"use client";

// Client messaging, portal side (Phase 2): the client's view of the thread
// with their accountant. Same comment-thread cadence as the firm side: loads
// with the portal, refreshes every 60s only while the view is open, appends
// your own message on send. Opening the view stamps the client's read pointer.
//
// TEXT ONLY by hard rule — documents must flow through the checklist so the
// AI pipeline checks them. The composer carries a permanent nudge pointing
// clients back to the checklist for anything file-shaped.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileUp, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import type { PortalMessage } from "@/lib/db/client-messages";

const MAX_LENGTH = 4000;
const POLL_MS = 60_000;

export function PortalMessages({
  token,
  firmName,
  initialMessages,
  readOnly,
  locale,
  onGoToDocuments,
}: {
  token: string;
  firmName: string;
  initialMessages: PortalMessage[];
  // Engagement complete → history visible, composer closed.
  readOnly: boolean;
  locale: "fr" | "en";
  // Jump back to the document checklist (the no-attachments nudge target).
  // Null when this portal has no document items to point at.
  onGoToDocuments: (() => void) | null;
}) {
  const t = useTranslations("Portal");
  const [messages, setMessages] = useState<PortalMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [locale],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/messages/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: PortalMessage[] };
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      // Background refresh only.
    }
  }, [token]);

  // This component only mounts while the Messages view is OPEN (the portal
  // unmounts it on back), so mount = "the client opened the thread": stamp
  // the read pointer once and start the slow poll.
  useEffect(() => {
    fetch("/api/portal/messages/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => undefined);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [token, refresh]);

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
      const res = await fetch("/api/portal/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, body }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: PortalMessage;
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

  const remaining = MAX_LENGTH - draft.length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("messages_intro", { firm: firmName })}
      </p>

      {messages.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center">
          <p className="text-[15px] font-medium text-foreground">
            {t("messages_empty_title")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("messages_empty_body", { firm: firmName })}
          </p>
        </div>
      ) : (
        <div
          ref={listRef}
          className="max-h-[26rem] space-y-3 overflow-y-auto rounded-2xl border border-border/60 bg-card p-3 shadow-sm"
        >
          {messages.map((m) => {
            const mine = m.sender === "client";
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
                  color={mine ? "#0f766e" : "#475569"}
                />
                <div
                  className={cn(
                    "max-w-[75%] space-y-1",
                    mine ? "text-right" : "text-left",
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
          })}
        </div>
      )}

      {readOnly ? (
        <p className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          {t("messages_read_only")}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value.slice(0, MAX_LENGTH));
                setSendError(false);
              }}
              placeholder={t("messages_placeholder")}
              rows={2}
              aria-label={t("messages_placeholder")}
              className="min-h-[3.25rem] flex-1 resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || draft.trim().length === 0}
              className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-50"
            >
              <Send className="size-4" aria-hidden />
              {sending ? t("messages_sending") : t("messages_send")}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                "text-xs text-destructive",
                !sendError && "invisible",
              )}
              role={sendError ? "alert" : undefined}
            >
              {t("messages_send_failed")}
            </p>
            {remaining <= 500 && (
              <p className="text-xs text-muted-foreground">
                {t("messages_chars_left", { count: remaining })}
              </p>
            )}
          </div>
          {/* The no-attachments nudge: files belong in the checklist, where
              they're automatically checked. Permanent, quiet, actionable. */}
          <p className="flex items-start gap-1.5 rounded-xl bg-secondary/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <FileUp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {t("messages_nudge")}{" "}
              {onGoToDocuments && (
                <button
                  type="button"
                  onClick={onGoToDocuments}
                  className="cursor-pointer font-medium text-foreground underline underline-offset-2 transition-colors hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("messages_nudge_link")}
                </button>
              )}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

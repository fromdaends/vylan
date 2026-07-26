"use client";

// Client messaging, portal side (Phase 2): the client's view of the thread
// with their accountant. Near-live cadence, matching the firm side: loads
// with the portal, refreshes every few seconds only while the view is open,
// appends your own message on send. Opening the view stamps the read pointer.
//
// TEXT ONLY by hard rule — documents must flow through the checklist so the
// AI pipeline checks them. The composer carries a permanent nudge pointing
// clients back to the checklist for anything file-shaped.

import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, FileUp, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MessageTimestamp,
  shouldShowMessageTimestamp,
} from "@/components/messages/message-timeline";
import type { PortalMessage } from "@/lib/db/client-messages";

const MAX_LENGTH = 4000;
// Near-live: refresh a few seconds apart while the thread is open + visible,
// so a reply lands within a few seconds (not the old comment-cadence minute).
const POLL_MS = 4_000;

export function PortalMessages({
  token,
  firmName,
  initialMessages,
  readOnly,
  locale,
  onBack,
}: {
  token: string;
  firmName: string;
  initialMessages: PortalMessage[];
  // Engagement complete → history visible, composer closed.
  readOnly: boolean;
  locale: "fr" | "en";
  // Close the mobile full-screen overlay. Rendered as a Back button that only
  // shows below lg (the desktop pane is permanent, so it has nothing to close).
  onBack?: () => void;
}) {
  const t = useTranslations("Portal");
  const [messages, setMessages] = useState<PortalMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

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
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Conversation header: who you're talking to, and — on mobile only — a
          Back button out of the full-screen thread. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("hub_back")}
            className="-ml-1.5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
        )}
        <AvatarInitials name={firmName} size={38} color="#475569" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold tracking-tight text-foreground">
            {t("messages_section_title")}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {firmName}
          </div>
        </div>
      </div>

      {/* Thread — the only scrolling region, so the composer stays put. */}
      <div
        ref={listRef}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5",
          messages.length === 0 ? "flex" : "space-y-3",
        )}
      >
        {messages.length === 0 ? (
          <div className="m-auto max-w-sm rounded-2xl border border-dashed border-border px-4 py-8 text-center">
            <p className="text-[15px] font-medium text-foreground">
              {t("messages_empty_title")}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("messages_empty_body", { firm: firmName })}
            </p>
          </div>
        ) : (
          messages.map((m, index) => {
            const mine = m.sender === "client";
            return (
              <Fragment key={m.id}>
                {shouldShowMessageTimestamp(messages, index) && (
                  <MessageTimestamp iso={m.created_at} locale={locale} />
                )}
                <div
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
                      "max-w-[75%]",
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
                  </div>
                </div>
              </Fragment>
            );
          })
        )}
      </div>

      {/* Composer / read-only note, pinned to the bottom. The extra bottom
          padding clears the iPhone home indicator (viewport-fit=cover). */}
      <div className="shrink-0 border-t border-border/60 px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] sm:px-5">
        {readOnly ? (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">
            {t("messages_read_only")}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value.slice(0, MAX_LENGTH));
                  setSendError(false);
                }}
                placeholder={t("messages_placeholder")}
                rows={1}
                aria-label={t("messages_placeholder")}
                onKeyDown={(event) => {
                  if (
                    event.key !== "Enter" ||
                    event.shiftKey ||
                    event.nativeEvent.isComposing
                  ) {
                    return;
                  }
                  event.preventDefault();
                  void handleSend();
                }}
                className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-2xl"
              />
              <Button
                type="button"
                size="icon"
                onClick={handleSend}
                disabled={sending || draft.trim().length === 0}
                aria-label={
                  sending ? t("messages_sending") : t("messages_send")
                }
                title={t("messages_send")}
                className="size-11 shrink-0 rounded-full"
              >
                <Send className="size-4" aria-hidden />
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
                {t("messages_send_failed")}
              </p>
              {remaining <= 500 && (
                <p className="text-xs text-muted-foreground">
                  {t("messages_chars_left", { count: remaining })}
                </p>
              )}
            </div>
            {/* The no-attachments nudge: files belong in the checklist, where
                they're automatically checked. Permanent and informational. */}
            <p className="flex items-start gap-1.5 rounded-xl bg-secondary/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <FileUp className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{t("messages_nudge")}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

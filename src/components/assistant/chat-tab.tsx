"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Send } from "lucide-react";
import {
  submitFeedbackAction,
  type FeedbackState,
} from "@/app/actions/feedback";
import {
  getAssistantServerSnapshot,
  getAssistantState,
  subscribeAssistant,
} from "@/components/assistant/assistant-store";

// The Assistant panel's Chat tab — phase 2: the ENGAGEMENT chat. Scoped to
// the engagement picked in the panel header; answers come from the model via
// POST /api/engagement-chat/message (NDJSON stream over a tool loop on the
// engagement's structured data). The conversation is persisted per
// engagement server-side and shared by the firm; GET /api/engagement-chat/
// history loads it on engagement switch along with the caller's rolling
// message-limit state.

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type LimitState = {
  limit: number;
  remaining: number;
  resetAt: string | null;
};

type View = "chat" | "feedback";

export function ChatTab({ locale }: { locale: "en" | "fr" }) {
  const [view, setView] = useState<View>("chat");
  const { open } = useSyncExternalStore(
    subscribeAssistant,
    getAssistantState,
    getAssistantServerSnapshot,
  );

  // Every (re)open lands on the chat view — a panel reopening straight onto
  // the feedback form reads as broken. Scheduled in a frame callback so the
  // effect body stays free of synchronous state writes.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => setView("chat"));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {view === "chat" ? (
        <motion.div
          key="chat"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex flex-col h-full min-h-0"
        >
          <ChatView
            locale={locale}
            onSwitchToFeedback={() => setView("feedback")}
          />
        </motion.div>
      ) : (
        <motion.div
          key="feedback"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex flex-col h-full min-h-0"
        >
          <FeedbackView onBack={() => setView("chat")} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Chat view
// ---------------------------------------------------------------------------

function ChatView({
  locale,
  onSwitchToFeedback,
}: {
  locale: "en" | "fr";
  onSwitchToFeedback: () => void;
}) {
  const t = useTranslations("Help");
  const ta = useTranslations("Assistant");
  const { open, selected } = useSyncExternalStore(
    subscribeAssistant,
    getAssistantState,
    getAssistantServerSnapshot,
  );
  const engagementId = selected?.id ?? null;

  // The loaded conversation, tagged with its engagement so a switch shows
  // the loading state instead of another engagement's thread.
  const [thread, setThread] = useState<{
    engagementId: string;
    messages: ChatMessage[];
  } | null>(null);
  const [limit, setLimit] = useState<LimitState | null>(null);
  // null = loading/unknown; false = migration not applied yet ("not
  // activated"); true = chat is live.
  const [ready, setReady] = useState<boolean | null>(null);
  const [historyFailedFor, setHistoryFailedFor] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // A lookup ("tool") event was seen for the in-flight turn — the thinking
  // indicator switches to "checking the engagement…".
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadingHistoryRef = useRef<string | null>(null);
  const engagementIdRef = useRef<string | null>(engagementId);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const isLoaded = thread !== null && thread.engagementId === engagementId;
  const messages = isLoaded ? thread.messages : [];
  const historyFailed =
    historyFailedFor !== null && historyFailedFor === engagementId;
  const limitReached = limit !== null && limit.remaining <= 0;

  // Track the current engagement and cancel whatever was in flight for the
  // previous one when the accountant switches.
  useEffect(() => {
    engagementIdRef.current = engagementId;
    return () => {
      abortRef.current?.abort();
    };
  }, [engagementId]);

  // Stop an in-flight stream when the panel closes — no point paying for
  // tokens nobody is reading. Whatever already streamed in stays visible.
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  const loadHistory = useCallback(async (id: string) => {
    if (loadingHistoryRef.current === id) return;
    loadingHistoryRef.current = id;
    try {
      const res = await fetch(
        `/api/engagement-chat/history?engagementId=${encodeURIComponent(id)}`,
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as {
        ready: boolean;
        messages?: {
          role: "user" | "assistant";
          content: string;
          createdAt: string;
        }[];
        limit?: number;
        remaining?: number;
        resetAt?: string | null;
      };
      if (engagementIdRef.current !== id) return;
      // A load is a clean slate for this engagement — any error banner from
      // a previous engagement (or a previous attempt) is stale now.
      setError(null);
      if (!body.ready) {
        setReady(false);
        setThread({ engagementId: id, messages: [] });
        setLimit(null);
        setHistoryFailedFor(null);
        return;
      }
      setReady(true);
      setThread({
        engagementId: id,
        messages: (body.messages ?? []).map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
      });
      setLimit({
        limit: body.limit ?? 0,
        remaining: body.remaining ?? 0,
        resetAt: body.resetAt ?? null,
      });
      setHistoryFailedFor(null);
    } catch {
      if (engagementIdRef.current === id) {
        setError(null);
        setHistoryFailedFor(id);
      }
    } finally {
      if (loadingHistoryRef.current === id) loadingHistoryRef.current = null;
    }
  }, []);

  // Load the conversation when the panel is open on an engagement whose
  // thread isn't loaded yet. State writes land in the fetch continuation —
  // the disable matches the repo's fetch-on-mount idiom.
  useEffect(() => {
    if (!open || !engagementId || isLoaded || historyFailed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory(engagementId);
  }, [open, engagementId, isLoaded, historyFailed, loadHistory]);

  // Every reopen quietly resyncs from the server: a teammate may have chatted
  // meanwhile, the limit window keeps rolling, and a "not activated yet"
  // state clears itself once the founder applies the migration.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const id = engagementIdRef.current;
      if (id) void loadHistory(id);
    }
    wasOpenRef.current = open;
  }, [open, loadHistory]);

  // When the limit is reached, wake up right after the freeing time and
  // resync — otherwise the lockout note would outlive the window and the
  // input would stay disabled until a manual reopen.
  useEffect(() => {
    if (!limitReached || !limit?.resetAt) return;
    const waitMs = new Date(limit.resetAt).getTime() - Date.now() + 2000;
    const timer = window.setTimeout(
      () => {
        const id = engagementIdRef.current;
        if (id) void loadHistory(id);
      },
      Math.max(waitMs, 1000),
    );
    return () => window.clearTimeout(timer);
  }, [limitReached, limit?.resetAt, loadHistory]);

  // Auto-scroll to bottom on new content. Keyed on the thread state itself
  // (stable reference) rather than the derived `messages` array.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread, streaming]);

  // Cleanup any in-flight stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-grow the textarea up to a cap.
  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    if (input === "" && inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [input]);

  // Update the loaded thread's messages, guarding against engagement
  // switches that happened while a request was in flight.
  const patchThread = useCallback(
    (id: string, fn: (msgs: ChatMessage[]) => ChatMessage[]) => {
      setThread((prev) =>
        prev && prev.engagementId === id
          ? { ...prev, messages: fn(prev.messages) }
          : prev,
      );
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const id = engagementIdRef.current;
      if (!trimmed || streaming || !id || ready !== true || limitReached) {
        return;
      }

      setError(null);
      setInput("");
      const createdAt = new Date().toISOString();
      patchThread(id, (msgs) => [
        ...msgs,
        { role: "user", content: trimmed, createdAt },
        // Placeholder assistant turn filled in as the stream arrives.
        { role: "assistant", content: "", createdAt },
      ]);
      setStreaming(true);
      setChecking(false);

      const controller = new AbortController();
      abortRef.current = controller;

      const dropPlaceholderPair = () =>
        patchThread(id, (msgs) => msgs.slice(0, -2));
      // Once the server accepted the request, the user message is persisted
      // and counted — later failures must NOT erase it from the thread (a
      // history reload would just resurrect it, looking like a duplicate).
      let streamStarted = false;
      let sawDone = false;

      try {
        const res = await fetch("/api/engagement-chat/message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ engagementId: id, message: trimmed, locale }),
        });

        if (!res.ok) {
          let code: string | null = null;
          let payload: { limit?: number; resetAt?: string | null } = {};
          try {
            const body = (await res.json()) as {
              error?: string;
              limit?: number;
              resetAt?: string | null;
            };
            code = body.error ?? null;
            payload = body;
          } catch {
            // non-JSON error body
          }
          // The message was NOT accepted server-side: remove the optimistic
          // pair and put the text back in the input so nothing typed is lost.
          dropPlaceholderPair();
          setInput(trimmed);
          if (code === "chat_limit") {
            setLimit({
              limit: payload.limit ?? 0,
              remaining: 0,
              resetAt: payload.resetAt ?? null,
            });
          } else if (code === "trial_limit") {
            setError(ta("trial_limit"));
          } else if (code === "chat_not_ready") {
            setReady(false);
          } else if (res.status === 401) {
            setError(t("ai_unauthorized"));
          } else if (res.status === 429) {
            setError(t("ai_rate_limited"));
          } else {
            setError(t("ai_error"));
          }
          setStreaming(false);
          return;
        }
        streamStarted = true;

        const reader = res.body?.getReader();
        if (!reader) {
          // Accepted but unreadable — keep the user message (it's persisted
          // server-side), just drop the empty placeholder.
          patchThread(id, (msgs) => msgs.slice(0, -1));
          setError(t("ai_error"));
          setStreaming(false);
          return;
        }

        // NDJSON: one JSON event per line.
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";
        const handleEvent = (line: string) => {
          let event: {
            t?: string;
            text?: string;
            remaining?: number;
            resetAt?: string | null;
            limit?: number;
          };
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (event.t === "delta" && typeof event.text === "string") {
            acc += event.text;
            const current = acc;
            patchThread(id, (msgs) => {
              const copy = msgs.slice();
              const last = copy[copy.length - 1];
              if (last && last.role === "assistant") {
                copy[copy.length - 1] = { ...last, content: current };
              }
              return copy;
            });
          } else if (event.t === "tool") {
            setChecking(true);
          } else if (event.t === "done") {
            sawDone = true;
            setLimit({
              limit: event.limit ?? 0,
              remaining: event.remaining ?? 0,
              resetAt: event.resetAt ?? null,
            });
          } else if (event.t === "error") {
            setError(t("ai_error"));
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) handleEvent(line);
          }
        }
        buffer += decoder.decode();
        const tail = buffer.trim();
        if (tail) handleEvent(tail);

        // Stream ended with no text at all (e.g. server error event only):
        // drop the empty placeholder so a blank bubble doesn't linger.
        if (!acc.trim()) {
          patchThread(id, (msgs) => {
            const last = msgs[msgs.length - 1];
            return last && last.role === "assistant" && last.content === ""
              ? msgs.slice(0, -1)
              : msgs;
          });
        }

        // The stream died before the done event (function timeout, dropped
        // connection): the server may have persisted more than we displayed
        // and DID count the message. Quietly resync thread + limit state
        // from the source of truth.
        if (!sawDone && engagementIdRef.current === id) {
          void loadHistory(id);
        }
      } catch (e) {
        const trimEmptyPlaceholder = () =>
          patchThread(id, (msgs) => {
            const last = msgs[msgs.length - 1];
            return last && last.role === "assistant" && last.content === ""
              ? msgs.slice(0, -1)
              : msgs;
          });
        if ((e as Error).name !== "AbortError") {
          setError(t("ai_error"));
          if (streamStarted) {
            // Accepted + partially streamed: keep what arrived (the server
            // persisted the exchange) and resync from the source of truth.
            trimEmptyPlaceholder();
            if (engagementIdRef.current === id) void loadHistory(id);
          } else {
            // Never reached the server: undo the optimistic pair and give
            // the user their text back.
            dropPlaceholderPair();
            setInput(trimmed);
          }
        } else {
          // Aborted (panel closed / engagement switched) before any text:
          // drop the still-empty placeholder.
          trimEmptyPlaceholder();
        }
      } finally {
        setStreaming(false);
        setChecking(false);
        abortRef.current = null;
        queueMicrotask(() => inputRef.current?.focus());
      }
    },
    [streaming, ready, limitReached, locale, t, ta, patchThread, loadHistory],
  );

  // ---- Render ----

  if (!engagementId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
        <p className="text-sm text-muted-foreground text-center leading-relaxed">
          {ta("no_engagement_chat")}
        </p>
        {/* Feedback stays reachable even before an engagement is picked —
            it was always available in the old help sheet. */}
        <button
          type="button"
          onClick={onSwitchToFeedback}
          className="text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {t("ai_send_feedback_compact")}
        </button>
      </div>
    );
  }

  const inputDisabled =
    streaming || ready !== true || limitReached || !isLoaded;

  return (
    <>
      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        {historyFailed ? (
          <div className="flex flex-col items-center gap-3 px-5 py-8">
            <p className="text-sm text-muted-foreground">
              {ta("activity_error")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setHistoryFailedFor(null)}
            >
              {ta("retry")}
            </Button>
          </div>
        ) : !isLoaded ? (
          <div className="space-y-4 px-5 py-6" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="flex items-start gap-3 animate-pulse">
                <span className="mt-1 size-7 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2 pt-1.5">
                  <div className="h-3.5 rounded bg-muted w-2/3" />
                  <div className="h-3 rounded bg-muted w-2/5" />
                </div>
              </div>
            ))}
          </div>
        ) : (
            <div className="flex flex-col gap-6 px-5 py-6">
              <ChatGreeting
                engagementTitle={selected?.title ?? ""}
                locale={locale}
              />

              {messages.length > 0 && (
                <div className="text-center text-xs text-muted-foreground/70 tabular-nums">
                  {formatConversationTime(messages[0].createdAt, locale)}
                </div>
              )}

              <AnimatePresence initial={false}>
                {messages.map((m, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                  >
                    <Message
                      role={m.role}
                      content={m.content}
                      isStreaming={
                        streaming &&
                        i === messages.length - 1 &&
                        m.role === "assistant"
                      }
                      checking={checking}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                </motion.div>
              )}
            </div>
        )}

        {isLoaded && messages.length === 0 && error && (
          <div className="px-5 pt-4">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}
      </div>

      {/* Status notes + input */}
      <div className="border-t border-border/40 px-4 pt-3 pb-4">
        {ready === false && (
          <p className="mb-2.5 px-1 text-xs text-muted-foreground leading-relaxed">
            {ta("chat_not_ready")}{" "}
            <button
              type="button"
              // Clearing the loaded thread re-arms the load effect — the
              // copy says "try again shortly", so give it a real retry.
              onClick={() => {
                setThread(null);
                setReady(null);
              }}
              className="underline underline-offset-2 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              {ta("retry")}
            </button>
          </p>
        )}
        {ready === true && limitReached && (
          <p className="mb-2.5 px-1 text-xs text-muted-foreground leading-relaxed">
            {ta("limit_reached", {
              limit: limit?.limit ?? 0,
              time: formatResetTime(limit?.resetAt ?? null, locale),
            })}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="relative"
        >
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              resizeTextarea();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder={ta("ask_placeholder")}
            maxLength={2000}
            disabled={inputDisabled}
            className="resize-none min-h-[48px] max-h-[160px] w-full rounded-2xl border-border/60 bg-secondary/40 focus-visible:bg-background focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring/20 pr-14 py-3.5 pl-4 text-sm leading-relaxed transition-colors placeholder:text-muted-foreground/70 disabled:opacity-60"
          />
          <motion.button
            type="submit"
            whileTap={{ scale: 0.9 }}
            disabled={inputDisabled || input.trim().length === 0}
            aria-label={t("ai_send")}
            className="absolute right-2 bottom-2 inline-flex items-center justify-center size-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 shadow-sm"
          >
            <Send className="size-4" aria-hidden />
          </motion.button>
        </form>
        <div className="flex items-center justify-between gap-3 mt-2.5 px-1 text-[11px] text-muted-foreground/70">
          <span className="hidden sm:inline tabular-nums">
            {t("ai_kbd_hint")}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {ready === true && limit !== null && !limitReached && (
              <span className="tabular-nums" aria-live="polite">
                {ta("remaining", { count: limit.remaining })}
              </span>
            )}
            <button
              type="button"
              onClick={onSwitchToFeedback}
              className="hover:text-foreground transition-colors underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              {t("ai_send_feedback_compact")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ChatGreeting({
  engagementTitle,
  locale,
}: {
  engagementTitle: string;
  locale: "en" | "fr";
}) {
  const ta = useTranslations("Assistant");
  const [index, setIndex] = useState(0);
  const greetings = [
    ta("greeting_1"),
    ta("greeting_2"),
    ta("greeting_3"),
    ta("greeting_4"),
  ];

  useEffect(() => {
    const timer = window.setInterval(
      () => setIndex((current) => (current + 1) % greetings.length),
      6000,
    );
    return () => window.clearInterval(timer);
  }, [greetings.length]);

  return (
    <div className="mx-auto max-w-sm px-4 pt-2 text-center">
      <p className="text-base font-medium tracking-tight text-foreground">
        {greetings[index]}
      </p>
      {engagementTitle && (
        <p className="mt-1 text-xs text-muted-foreground">
          {ta("greeting_context", { title: engagementTitle })}
        </p>
      )}
      <p className="mt-2 text-[10px] tracking-wide text-muted-foreground/50">
        {locale === "fr" ? "Propulsé par Haiku 4" : "Powered by Haiku 4"}
      </p>
    </div>
  );
}

function formatConversationTime(iso: string, locale: "en" | "fr"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const day =
    date.toDateString() === now.toDateString()
      ? locale === "fr"
        ? "Aujourd’hui"
        : "Today"
      : date.toDateString() === yesterday.toDateString()
        ? locale === "fr"
          ? "Hier"
          : "Yesterday"
        : new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
            month: "short",
            day: "numeric",
          }).format(date);
  const time = new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${day} ${time}`;
}

// When the next message frees up, in words the founder's clients would use.
// The window is 36h, so it's always today, tomorrow, or the day after.
function formatResetTime(iso: string | null, locale: "en" | "fr"): string {
  if (!iso) return locale === "fr" ? "plus tard" : "later";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return locale === "fr" ? "plus tard" : "later";
  }
  const intlLocale = locale === "fr" ? "fr-CA" : "en-CA";
  const time = new Intl.DateTimeFormat(intlLocale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) {
    return locale === "fr" ? `aujourd'hui à ${time}` : `today at ${time}`;
  }
  if (d.toDateString() === tomorrow.toDateString()) {
    return locale === "fr" ? `demain à ${time}` : `tomorrow at ${time}`;
  }
  const date = new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "long",
  }).format(d);
  return locale === "fr" ? `le ${date} à ${time}` : `on ${date} at ${time}`;
}

// ---------------------------------------------------------------------------
// Message bubbles
// ---------------------------------------------------------------------------

function Message({
  role,
  content,
  isStreaming,
  checking,
}: {
  role: "user" | "assistant";
  content: string;
  isStreaming: boolean;
  checking: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-3xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
          {content}
        </div>
      </div>
    );
  }
  const isThinking = isStreaming && content.length === 0;
  return (
    <div className="flex items-start">
      <div className="min-w-0 flex-1">
        {isThinking ? (
          <ThinkingIndicator checking={checking} />
        ) : (
          <AssistantContent text={content} isStreaming={isStreaming} />
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator({ checking }: { checking: boolean }) {
  const t = useTranslations("Help");
  const ta = useTranslations("Assistant");
  return (
    <div className="flex items-center gap-2 text-muted-foreground h-7">
      <div className="flex gap-1">
        <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:-280ms] [animation-duration:1.1s]" />
        <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:-140ms] [animation-duration:1.1s]" />
        <span className="size-1.5 rounded-full bg-current animate-bounce [animation-duration:1.1s]" />
      </div>
      <span className="text-xs">
        {checking ? ta("tool_checking") : t("ai_thinking")}
      </span>
    </div>
  );
}

// Renders the assistant's reply as paragraphs separated by blank lines.
// The system prompt strictly instructs the model to emit plain prose,
// but models slip occasionally — sanitizeAssistantText strips any
// markdown chars that leaked through so the user never sees raw
// asterisks, hashes, backticks, or bullet dashes. A blinking caret
// trails the last paragraph while the stream is open.
function AssistantContent({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const cleaned = sanitizeAssistantText(text);
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    return isStreaming ? <StreamingCaret /> : null;
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground">
      {paragraphs.map((p, i) => {
        const isLast = i === paragraphs.length - 1;
        return (
          <p key={i} className="break-words whitespace-pre-line">
            {p}
            {isStreaming && isLast ? <StreamingCaret /> : null}
          </p>
        );
      })}
    </div>
  );
}

// Defensive post-processing of the streamed model output. The prompt
// forbids markdown but we cannot trust that — strip every common
// markdown signal so users see clean prose even if the model regresses.
// Order matters: do the inline transforms BEFORE the line-collapse
// step so leading-line markers (- , * , #) still match at line start.
//
// One deliberate difference from the old help chat: SINGLE newlines are
// kept (rendered via whitespace-pre-line) because the engagement chat
// legitimately answers with short line-separated lists ("what's
// missing"). Only markdown decoration is stripped.
function sanitizeAssistantText(raw: string): string {
  let text = raw;

  // Markdown links → just the visible text. [Click here](https://...) → Click here
  text = text.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, "$1");

  // Inline code → drop the backticks, keep the content. \`foo\` → foo
  text = text.replace(/`+([^`\n]+?)`+/g, "$1");

  // Bold → keep the content but drop the asterisks. **foo** → foo.
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "$1");

  // Italic via single asterisks / underscores → drop the markers.
  text = text.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\w)/g, "$1");
  text = text.replace(/(?<![_\w])_([^_\n]+?)_(?!\w)/g, "$1");

  // Leading list markers at the start of a line → strip the marker,
  // keep the content. Handles both - and * bullets.
  text = text.replace(/^[ \t]*[-*][ \t]+/gm, "");

  // Leading heading markers (#, ##, ###…) → strip, keep title text.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");

  // Horizontal rules — full lines of ---, ***, or ___ → drop the line.
  text = text.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "");

  // Normalize any run of 3+ newlines down to exactly two.
  text = text.replace(/\n{3,}/g, "\n\n");

  // Collapse runs of internal spaces/tabs to single spaces.
  text = text.replace(/[ \t]{2,}/g, " ");

  return text.trim();
}

function StreamingCaret() {
  return (
    <span
      aria-hidden
      className="inline-block w-[2px] h-[0.95em] align-text-bottom translate-y-[1px] bg-foreground/70 ml-0.5 animate-pulse [animation-duration:1s]"
    />
  );
}

// ---------------------------------------------------------------------------
// Feedback view (preserved from the old Help sidebar — reachable from the
// chat footer link, exactly as before).
// ---------------------------------------------------------------------------

function FeedbackView({ onBack }: { onBack: () => void }) {
  const t = useTranslations("Help");
  const tc = useTranslations("Common");
  const [pageUrl, setPageUrl] = useState("");
  const [state, action, pending] = useActionState<FeedbackState, FormData>(
    submitFeedbackAction,
    null,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    queueMicrotask(() => setPageUrl(window.location.pathname));
  }, []);

  return (
    <>
      <header className="flex items-center gap-3 px-5 py-4 border-b border-border/40">
        <motion.button
          type="button"
          whileHover={{ x: -2 }}
          whileTap={{ scale: 0.9 }}
          onClick={onBack}
          className="shrink-0 inline-flex items-center justify-center rounded-full size-8 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
          aria-label={t("ai_back_to_chat")}
        >
          <ArrowLeft className="size-4" aria-hidden />
        </motion.button>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight tracking-tight">
            {t("feedback_title")}
          </h2>
          <p className="text-xs text-muted-foreground leading-tight mt-0.5">
            {t("feedback_subtitle")}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-6 space-y-5">
        <form action={action} className="space-y-3">
          <input type="hidden" name="page_url" value={pageUrl} />
          {state?.ok && (
            <Alert>
              <AlertDescription>{t("feedback_thanks")}</AlertDescription>
            </Alert>
          )}
          {state?.error && (
            <Alert variant="destructive">
              <AlertDescription>
                {t.has(`errors.${state.error}` as const)
                  ? t(`errors.${state.error}` as const)
                  : state.error}
              </AlertDescription>
            </Alert>
          )}
          <Textarea
            name="message"
            rows={6}
            placeholder={t("feedback_placeholder")}
            required
            minLength={3}
            maxLength={2000}
            className="rounded-2xl resize-none"
          />
          <Button type="submit" disabled={pending} className="rounded-full">
            <Send className="size-4" aria-hidden />
            {pending ? tc("saving") : t("feedback_submit")}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground">
          {t("footer_email_or")}{" "}
          <a
            href="mailto:hello@vylan.app"
            className="text-foreground underline underline-offset-2"
          >
            hello@vylan.app
          </a>
        </p>
      </div>
    </>
  );
}

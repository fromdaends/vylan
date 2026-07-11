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
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, RefreshCw, Send, Sparkles } from "lucide-react";
import {
  submitFeedbackAction,
  type FeedbackState,
} from "@/app/actions/feedback";
import {
  getAssistantServerSnapshot,
  getAssistantState,
  subscribeAssistant,
} from "@/components/assistant/assistant-store";

// The Assistant panel's Chat tab. Phase 1 ports the existing "Ask Vylan"
// product-help chat (POST /api/assistant, streamed plain text) unchanged so
// nothing regresses while the panel shell ships; Phase 2 swaps the backend to
// the engagement-scoped chat endpoint. Strings stay in the `Help` namespace
// for the same reason — they already exist in both languages.

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type View = "chat" | "feedback";

export function ChatTab({ locale }: { locale: "en" | "fr" }) {
  const [view, setView] = useState<View>("chat");
  const { open } = useSyncExternalStore(
    subscribeAssistant,
    getAssistantState,
    getAssistantServerSnapshot,
  );

  // Every (re)open lands on the chat view — the old sheet reset to chat on
  // the Help-menu open event, and a panel reopening straight onto the
  // feedback form reads as broken. Scheduled in a frame callback so the
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
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const { open } = useSyncExternalStore(
    subscribeAssistant,
    getAssistantState,
    getAssistantServerSnapshot,
  );

  const isEmpty = messages.length === 0;

  // The old Sheet unmounted this view on close, killing any in-flight
  // stream via the unmount cleanup. The panel keeps the tab mounted, so
  // stop the stream explicitly when the panel closes — no point paying for
  // tokens nobody is reading. Whatever already streamed in stays visible.
  useEffect(() => {
    if (!open) abortRef.current?.abort();
  }, [open]);

  // Auto-scroll to bottom on new content. useLayoutEffect so the scroll
  // happens in the same paint as the layout update — no flicker.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Cleanup any in-flight stream if the panel closes / component unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-grow the textarea up to a cap. Reset to natural height when
  // the field empties so the input shrinks back after a send.
  const resizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 160);
    el.style.height = `${next}px`;
  }, []);

  useEffect(() => {
    if (input === "" && inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [input]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      setError(null);
      setInput("");

      const nextHistory: ChatMessage[] = [
        ...messages,
        { role: "user", content: trimmed },
        // Placeholder assistant turn we'll fill in as the stream
        // arrives. Empty content prevents flicker.
        { role: "assistant", content: "" },
      ];
      setMessages(nextHistory);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: nextHistory
              .slice(0, -1)
              .map((m) => ({ role: m.role, content: m.content })),
            locale,
            pathname,
          }),
        });

        if (!res.ok) {
          let key = "ai_error";
          if (res.status === 401) key = "ai_unauthorized";
          if (res.status === 429) key = "ai_rate_limited";
          setError(t(key));
          setMessages((prev) => prev.slice(0, -1));
          setStreaming(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setError(t("ai_error"));
          setMessages((prev) => prev.slice(0, -1));
          setStreaming(false);
          return;
        }

        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const copy = prev.slice();
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = { role: "assistant", content: acc };
            }
            return copy;
          });
        }
        acc += decoder.decode();
        setMessages((prev) => {
          const copy = prev.slice();
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { role: "assistant", content: acc };
          }
          return copy;
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError(t("ai_error"));
          setMessages((prev) => prev.slice(0, -1));
        } else {
          // Aborted (panel closed / reset) before any text arrived: drop the
          // still-empty placeholder so a blank assistant bubble doesn't
          // linger in the kept-mounted history.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            return last && last.role === "assistant" && last.content === ""
              ? prev.slice(0, -1)
              : prev;
          });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        queueMicrotask(() => inputRef.current?.focus());
      }
    },
    [messages, streaming, locale, pathname, t],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    queueMicrotask(() => inputRef.current?.focus());
  }, []);

  return (
    <>
      {/* Body — empty until the first message; no greeting or prompts. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        {!isEmpty && (
          <div className="px-5 py-6 flex flex-col gap-6">
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

        {isEmpty && error && (
          <div className="px-5 pb-4">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border/40 px-4 pt-3 pb-4">
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
            placeholder={t("ai_input_placeholder")}
            maxLength={4000}
            disabled={streaming}
            className="resize-none min-h-[48px] max-h-[160px] w-full rounded-2xl border-border/60 bg-secondary/40 focus-visible:bg-background focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring/20 pr-14 py-3.5 pl-4 text-sm leading-relaxed transition-colors placeholder:text-muted-foreground/70"
          />
          <motion.button
            type="submit"
            whileTap={{ scale: 0.9 }}
            disabled={streaming || input.trim().length === 0}
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
            {!isEmpty && (
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                aria-label={t("ai_reset")}
                title={t("ai_reset")}
              >
                <RefreshCw className="size-3" aria-hidden />
                {t("ai_reset")}
              </button>
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

// ---------------------------------------------------------------------------
// Message bubbles
// ---------------------------------------------------------------------------

function Message({
  role,
  content,
  isStreaming,
}: {
  role: "user" | "assistant";
  content: string;
  isStreaming: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="rounded-2xl bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed max-w-[82%] whitespace-pre-wrap break-words shadow-sm">
          {content}
        </div>
      </div>
    );
  }
  const isThinking = isStreaming && content.length === 0;
  return (
    <div className="flex gap-3 items-start">
      <div
        aria-hidden
        className="shrink-0 size-7 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center ring-1 ring-accent/15 mt-0.5"
      >
        <Sparkles className="size-3.5 text-accent" aria-hidden />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        {isThinking ? (
          <ThinkingIndicator />
        ) : (
          <AssistantContent text={content} isStreaming={isStreaming} />
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  const t = useTranslations("Help");
  return (
    <div className="flex items-center gap-2 text-muted-foreground h-7">
      <div className="flex gap-1">
        <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:-280ms] [animation-duration:1.1s]" />
        <span className="size-1.5 rounded-full bg-current animate-bounce [animation-delay:-140ms] [animation-duration:1.1s]" />
        <span className="size-1.5 rounded-full bg-current animate-bounce [animation-duration:1.1s]" />
      </div>
      <span className="text-xs">{t("ai_thinking")}</span>
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
          <p key={i} className="break-words">
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
function sanitizeAssistantText(raw: string): string {
  let text = raw;

  // Markdown links → just the visible text. [Click here](https://...) → Click here
  text = text.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, "$1");

  // Inline code → drop the backticks, keep the content. \`foo\` → foo
  text = text.replace(/`+([^`\n]+?)`+/g, "$1");

  // Bold → keep the content but drop the asterisks. **foo** → foo.
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "$1");

  // Italic via single asterisks / underscores → drop the markers.
  // Negative look-arounds keep us from eating ** that the pass above
  // already handled, or stray underscores inside identifiers.
  text = text.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\w)/g, "$1");
  text = text.replace(/(?<![_\w])_([^_\n]+?)_(?!\w)/g, "$1");

  // Leading list markers at the start of a line → strip the marker,
  // keep the content. Handles both - and * bullets.
  text = text.replace(/^[ \t]*[-*][ \t]+/gm, "");

  // Leading heading markers (#, ##, ###…) → strip, keep title text.
  text = text.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");

  // Horizontal rules — full lines of ---, ***, or ___ → drop the line.
  text = text.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "");

  // Inside a paragraph, collapse single newlines (soft wraps from the
  // model) into spaces so the chat panel's own wrapping is what the
  // user sees. Paragraph breaks (2+ newlines) survive because we
  // split on those upstream.
  text = text.replace(/(?<!\n)\n(?!\n)/g, " ");

  // Normalize any run of 3+ newlines down to exactly two so the
  // paragraph splitter produces consistent spacing.
  text = text.replace(/\n{3,}/g, "\n\n");

  // Collapse runs of internal whitespace to single spaces (the
  // newline-to-space pass above can leave doubles).
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

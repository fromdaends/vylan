"use client";

import type { ReactNode } from "react";
import {
  useActionState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  Lock,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  submitFeedbackAction,
  type FeedbackState,
} from "@/app/actions/feedback";

// Order matches Help.ai_suggested_1..4. The icon for each suggestion is
// chosen to telegraph what kind of help the user is about to get.
const SUGGESTION_ICONS = [Send, ShieldCheck, Lock, Download] as const;

type Props = {
  locale: "en" | "fr";
  userDisplayName: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type View = "chat" | "feedback";

export function HelpSidebar({ locale, userDisplayName }: Props) {
  const t = useTranslations("Help");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");

  // The profile dropdown's "Help" menu item dispatches this event so
  // we can open the sheet without lifting state to a shared context.
  useEffect(() => {
    function onOpen() {
      setOpen(true);
      setView("chat");
    }
    window.addEventListener("vylan:open-help", onOpen);
    return () => window.removeEventListener("vylan:open-help", onOpen);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <motion.button
          type="button"
          whileHover={{ scale: 1.04, y: -1 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:bottom-6 right-4 sm:right-6 z-50 group inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-[0_10px_30px_-10px_rgba(0,0,0,0.45)] ring-1 ring-black/5 dark:ring-white/5 hover:shadow-[0_16px_40px_-12px_rgba(0,0,0,0.5)] transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={t("open_help")}
        >
          <span className="relative inline-flex items-center justify-center">
            <span
              aria-hidden
              className="absolute inset-0 -m-1 rounded-full bg-accent/40 blur-md opacity-0 group-hover:opacity-100 transition-opacity"
            />
            <Sparkles className="relative size-4" aria-hidden />
          </span>
          <span>{t("ai_button")}</span>
        </motion.button>
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full sm:max-w-lg flex flex-col p-0 gap-0 border-l border-border/60"
      >
        <AnimatePresence mode="wait" initial={false}>
          {view === "chat" ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="flex flex-col h-full"
            >
              <ChatView
                locale={locale}
                userDisplayName={userDisplayName}
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
              className="flex flex-col h-full"
            >
              <FeedbackView onBack={() => setView("chat")} />
            </motion.div>
          )}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Chat view
// ---------------------------------------------------------------------------

function ChatView({
  locale,
  userDisplayName,
  onSwitchToFeedback,
}: {
  locale: "en" | "fr";
  userDisplayName: string;
  onSwitchToFeedback: () => void;
}) {
  const t = useTranslations("Help");
  const tc = useTranslations("Common");
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const isEmpty = messages.length === 0;

  // Auto-scroll to bottom on new content. useLayoutEffect so the scroll
  // happens in the same paint as the layout update — no flicker.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Cleanup any in-flight stream if the sheet closes / component
  // unmounts.
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

  const suggestions = [
    t("ai_suggested_1"),
    t("ai_suggested_2"),
    t("ai_suggested_3"),
    t("ai_suggested_4"),
  ];

  return (
    <>
      {/* Header */}
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/40 bg-gradient-to-b from-accent/[0.03] to-transparent">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div className="size-9 rounded-full bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center ring-1 ring-accent/20">
              <Sparkles className="size-4 text-accent" aria-hidden />
            </div>
          </div>
          <div className="min-w-0">
            <SheetTitle className="text-[15px] font-semibold leading-tight tracking-tight">
              {t("ai_title")}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground leading-tight mt-0.5">
              {t("ai_subtitle")}
            </SheetDescription>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <AnimatePresence>
            {!isEmpty && (
              <motion.button
                key="reset"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
                whileHover={{ rotate: -90 }}
                whileTap={{ scale: 0.9 }}
                type="button"
                onClick={reset}
                className="inline-flex items-center justify-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                aria-label={t("ai_reset")}
                title={t("ai_reset")}
              >
                <RefreshCw className="size-4" aria-hidden />
              </motion.button>
            )}
          </AnimatePresence>
          <SheetClose asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
              aria-label={tc("close")}
            >
              <X className="size-4" aria-hidden />
            </button>
          </SheetClose>
        </div>
      </header>

      {/* Body */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain"
      >
        {isEmpty ? (
          <EmptyState
            displayName={userDisplayName}
            suggestions={suggestions}
            onPick={send}
          />
        ) : (
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
      <div className="border-t border-border/40 px-4 pt-3 pb-4 bg-background/95 backdrop-blur-sm">
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
          <button
            type="button"
            onClick={onSwitchToFeedback}
            className="ml-auto hover:text-foreground transition-colors underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
          >
            {t("ai_send_feedback_compact")}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  displayName,
  suggestions,
  onPick,
}: {
  displayName: string;
  suggestions: string[];
  onPick: (q: string) => void;
}) {
  const t = useTranslations("Help");
  return (
    <div className="px-5 pt-8 pb-6">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex flex-col items-center text-center mb-7"
      >
        <div className="relative mb-4">
          <motion.div
            aria-hidden
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 -m-2 rounded-full bg-accent/25 blur-2xl"
          />
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="relative size-14 rounded-2xl bg-gradient-to-br from-accent/25 via-accent/10 to-transparent flex items-center justify-center ring-1 ring-accent/25 shadow-sm"
          >
            <Sparkles className="size-6 text-accent" aria-hidden />
          </motion.div>
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          {t("ai_hello", { name: firstName(displayName) || "👋" })}
        </h2>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-[300px]">
          {t("ai_intro_sub")}
        </p>
      </motion.div>

      <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80 font-semibold mb-2.5 px-1">
        {t("ai_suggested_title")}
      </div>
      <motion.div
        className="grid gap-2"
        initial="hidden"
        animate="visible"
        variants={{
          visible: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } },
        }}
      >
        {suggestions.map((q, i) => {
          const Icon = SUGGESTION_ICONS[i] ?? Sparkles;
          return (
            <motion.button
              key={q}
              variants={{
                hidden: { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0 },
              }}
              whileHover={{ x: 2 }}
              whileTap={{ scale: 0.985 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              type="button"
              onClick={() => onPick(q)}
              className="group flex items-center gap-3 text-left text-sm rounded-2xl border border-border/50 bg-card hover:border-border/80 hover:bg-secondary/40 px-3.5 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="shrink-0 size-8 rounded-xl bg-secondary/70 group-hover:bg-accent/10 flex items-center justify-center transition-colors">
                <Icon
                  className="size-4 text-muted-foreground group-hover:text-accent transition-colors"
                  aria-hidden
                />
              </span>
              <span className="leading-snug flex-1">{q}</span>
              <ChevronRight
                className="shrink-0 size-4 text-muted-foreground/40 group-hover:text-foreground/60 group-hover:translate-x-0.5 transition-all"
                aria-hidden
              />
            </motion.button>
          );
        })}
      </motion.div>
    </div>
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
// The system prompt strictly instructs the model to use plain prose,
// but we still do a light \`**bold**\` pass in case it slips through.
// A blinking caret trails the last paragraph while the stream is open.
function AssistantContent({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    return isStreaming ? <StreamingCaret /> : null;
  }
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-foreground">
      {paragraphs.map((p, i) => {
        const isLast = i === paragraphs.length - 1;
        return (
          <p key={i} className="whitespace-pre-wrap break-words">
            {renderInline(p)}
            {isStreaming && isLast ? <StreamingCaret /> : null}
          </p>
        );
      })}
    </div>
  );
}

function StreamingCaret() {
  return (
    <span
      aria-hidden
      className="inline-block w-[2px] h-[0.95em] align-text-bottom translate-y-[1px] bg-foreground/70 ml-0.5 animate-pulse [animation-duration:1s]"
    />
  );
}

function renderInline(text: string): ReactNode[] {
  // Split on **bold** runs. Even indices are plain, odd are bold.
  const parts = text.split(/\*\*([^*\n]+)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
  );
}

function firstName(label: string): string {
  return label.split(/\s+/)[0] ?? "";
}

// ---------------------------------------------------------------------------
// Feedback view (preserved from the prior Help sidebar so we don't
// lose the surface — just demoted to a secondary view reachable from
// the chat footer link).
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
      <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/40">
        <div className="flex items-center gap-3 min-w-0">
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
            <SheetTitle className="text-[15px] font-semibold leading-tight tracking-tight">
              {t("feedback_title")}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground leading-tight mt-0.5">
              {t("feedback_subtitle")}
            </SheetDescription>
          </div>
        </div>
        <SheetClose asChild>
          <button
            type="button"
            className="shrink-0 inline-flex items-center justify-center size-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            aria-label={tc("close")}
          >
            <X className="size-4" aria-hidden />
          </button>
        </SheetClose>
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

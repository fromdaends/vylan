"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ArrowLeft,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import {
  submitFeedbackAction,
  type FeedbackState,
} from "@/app/actions/feedback";

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

  // Profile dropdown's "Help" menu item dispatches this event.
  useEffect(() => {
    function onOpen() {
      setOpen(true);
      setView("chat");
    }
    window.addEventListener("relai:open-help", onOpen);
    return () => window.removeEventListener("relai:open-help", onOpen);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("open_help")}
        >
          <Sparkles className="size-4" aria-hidden />
          {t("ai_button")}
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col p-0"
      >
        {view === "chat" ? (
          <ChatView
            locale={locale}
            userDisplayName={userDisplayName}
            onSwitchToFeedback={() => setView("feedback")}
          />
        ) : (
          <FeedbackView
            t={t}
            onBack={() => setView("chat")}
          />
        )}
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
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const isEmpty = messages.length === 0;

  // Auto-scroll to bottom on new content.
  useEffect(() => {
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
          // Drop the empty placeholder assistant turn.
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
        // Flush any trailing buffered bytes.
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
  }, []);

  const suggestions = [
    t("ai_suggested_1"),
    t("ai_suggested_2"),
    t("ai_suggested_3"),
    t("ai_suggested_4"),
  ];

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="px-4 py-3 border-b border-border/60">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <SheetTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4 text-primary" aria-hidden />
              {t("ai_title")}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {t("ai_subtitle")}
            </SheetDescription>
          </div>
          {!isEmpty && (
            <button
              type="button"
              onClick={reset}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("ai_reset")}
            >
              <RefreshCw className="size-3" aria-hidden />
              {t("ai_reset")}
            </button>
          )}
        </div>
      </SheetHeader>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        {isEmpty ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("ai_intro", {
                name: firstName(userDisplayName) || "👋",
              })}
            </p>
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                {t("ai_suggested_title")}
              </div>
              <div className="grid gap-2">
                {suggestions.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => send(q)}
                    className="text-left text-sm rounded-md border border-border/70 bg-card hover:bg-secondary/60 hover:border-border px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <MessageBubble
                key={i}
                role={m.role}
                content={m.content}
                isStreaming={
                  streaming &&
                  i === messages.length - 1 &&
                  m.role === "assistant"
                }
              />
            ))}
          </>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="border-t border-border/60 p-3 space-y-2 bg-background">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex gap-2 items-end"
        >
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder={t("ai_input_placeholder")}
            maxLength={4000}
            disabled={streaming}
            className="resize-none min-h-[44px]"
          />
          <Button
            type="submit"
            size="icon"
            disabled={streaming || input.trim().length === 0}
            aria-label={t("ai_send")}
          >
            <Send className="size-4" aria-hidden />
          </Button>
        </form>
        <p className="text-[11px] text-muted-foreground leading-snug">
          {t("ai_disclaimer")}{" "}
          <button
            type="button"
            onClick={onSwitchToFeedback}
            className="underline hover:text-foreground"
          >
            {t("ai_send_feedback_link_label")}
          </button>
        </p>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  isStreaming,
}: {
  role: "user" | "assistant";
  content: string;
  isStreaming: boolean;
}) {
  const t = useTranslations("Help");
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="rounded-2xl rounded-br-md bg-primary text-primary-foreground px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words">
          {content}
        </div>
      </div>
    );
  }
  const isThinking = isStreaming && content.length === 0;
  return (
    <div className="flex">
      <div className="rounded-2xl rounded-bl-md bg-secondary text-foreground px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap break-words">
        {isThinking ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="size-1.5 rounded-full bg-current animate-pulse" />
            <span className="size-1.5 rounded-full bg-current animate-pulse [animation-delay:120ms]" />
            <span className="size-1.5 rounded-full bg-current animate-pulse [animation-delay:240ms]" />
            <span className="ml-1 text-xs">{t("ai_thinking")}</span>
          </span>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

function firstName(label: string): string {
  return label.split(/\s+/)[0] ?? "";
}

// ---------------------------------------------------------------------------
// Feedback view (preserved from the prior Help sidebar so we don't
// lose the existing surface — just demoted to a secondary tab).
// ---------------------------------------------------------------------------

function FeedbackView({
  t,
  onBack,
}: {
  t: ReturnType<typeof useTranslations<"Help">>;
  onBack: () => void;
}) {
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
    <div className="flex flex-col h-full">
      <SheetHeader className="px-4 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center justify-center rounded-md h-7 w-7 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("ai_back_to_chat")}
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
          <div className="min-w-0">
            <SheetTitle className="text-base">{t("feedback_title")}</SheetTitle>
            <SheetDescription className="text-xs">
              {t("feedback_subtitle")}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
          />
          <Button type="submit" disabled={pending}>
            <Send className="size-4" aria-hidden />
            {pending ? tc("saving") : t("feedback_submit")}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground">
          {t("footer_email_or")}{" "}
          <a
            href="mailto:support@relai.app"
            className="text-foreground underline"
          >
            support@relai.app
          </a>
        </p>
      </div>
    </div>
  );
}

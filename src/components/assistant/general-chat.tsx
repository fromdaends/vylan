"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Send } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AssistantContent } from "@/components/assistant/assistant-content";

type Msg = { role: "user" | "assistant"; content: string };

// The general "ask about the software" chat, shown when no engagement is
// selected. Unlike the engagement chat it needs no engagement, keeps its
// history only in memory (client-held), and streams PLAIN TEXT from
// /api/assistant (the in-app help assistant). Opens on a big centered greeting,
// like other AI apps.
export function GeneralChat({
  locale,
  onSwitchToFeedback,
}: {
  locale: "en" | "fr";
  onSwitchToFeedback: () => void;
}) {
  const t = useTranslations("Help");
  const ta = useTranslations("Assistant");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll to the newest content as it streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Abort an in-flight request if the panel unmounts (e.g. an engagement gets
  // selected and this view is replaced).
  useEffect(() => () => abortRef.current?.abort(), []);

  function resizeTextarea() {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  const send = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || streaming) return;
      setError(null);
      setInput("");
      queueMicrotask(resizeTextarea);

      const history = [
        ...messages,
        { role: "user" as const, content: trimmed },
      ];
      // Show the user turn plus an empty assistant placeholder to stream into.
      setMessages([...history, { role: "assistant", content: "" }]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            messages: history,
            locale,
            pathname:
              typeof window !== "undefined"
                ? window.location.pathname
                : undefined,
          }),
        });

        if (res.status === 429) {
          setError(ta("general_rate_limited"));
          // Drop the empty placeholder.
          setMessages((prev) =>
            prev.filter(
              (m, i) =>
                !(
                  i === prev.length - 1 &&
                  m.role === "assistant" &&
                  m.content === ""
                ),
            ),
          );
          return;
        }
        if (!res.ok || !res.body) {
          setError(ta("general_error"));
          setMessages((prev) =>
            prev.filter(
              (m, i) =>
                !(
                  i === prev.length - 1 &&
                  m.role === "assistant" &&
                  m.content === ""
                ),
            ),
          );
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { role: "assistant", content: acc };
            }
            return next;
          });
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        console.error("[general-chat] send failed:", e);
        setError(ta("general_error"));
        setMessages((prev) =>
          prev.filter(
            (m, i) =>
              !(
                i === prev.length - 1 &&
                m.role === "assistant" &&
                m.content === ""
              ),
          ),
        );
      } finally {
        setStreaming(false);
        abortRef.current = null;
        queueMicrotask(() => inputRef.current?.focus());
      }
    },
    [messages, streaming, locale, ta],
  );

  const empty = messages.length === 0;

  return (
    <>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {empty ? (
          // Big centered greeting, like other AI apps.
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <h2 className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
              {ta("general_greeting")}
            </h2>
            <p className="max-w-xs text-sm text-muted-foreground">
              {ta("general_subtitle")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 px-5 py-6">
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              if (m.role === "user") {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[82%] whitespace-pre-wrap break-words rounded-3xl bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground">
                      {m.content}
                    </div>
                  </div>
                );
              }
              const isThinking = streaming && isLast && m.content.length === 0;
              return (
                <div key={i} className="flex items-start">
                  <div className="min-w-0 flex-1">
                    {isThinking ? (
                      <div className="flex h-7 items-center gap-2 text-muted-foreground">
                        <div className="flex gap-1">
                          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-280ms] [animation-duration:1.1s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-140ms] [animation-duration:1.1s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-duration:1.1s]" />
                        </div>
                        <span className="text-xs">{t("ai_thinking")}</span>
                      </div>
                    ) : (
                      <AssistantContent
                        text={m.content}
                        isStreaming={streaming && isLast}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border bg-card px-4 pt-3 pb-4">
        {empty && error && (
          <div className="mb-2.5">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
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
            placeholder={ta("general_placeholder")}
            maxLength={2000}
            disabled={streaming}
            className="min-h-[48px] max-h-[160px] w-full resize-none rounded-2xl border-border bg-secondary py-3.5 pr-14 pl-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-border focus-visible:bg-secondary focus-visible:ring-0 disabled:opacity-60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          />
          <motion.button
            type="submit"
            whileTap={{ scale: 0.9 }}
            disabled={streaming || input.trim().length === 0}
            aria-label={t("ai_send")}
            className="absolute right-2 bottom-2 inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Send className="size-4" aria-hidden />
          </motion.button>
        </form>
        <div className="mt-2.5 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
          <span>{ta("general_footer")}</span>
          <button
            type="button"
            onClick={onSwitchToFeedback}
            className="hover:text-muted-foreground focus-visible:outline-none"
          >
            {t("ai_send_feedback_compact")}
          </button>
        </div>
      </div>
    </>
  );
}

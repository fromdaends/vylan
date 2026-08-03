"use client";

// A question on the client portal: something the firm needs told, not sent.
//
// The rest of the checklist asks for documents. This one asks "what was this
// $340 at Costco on 3 July for?" — a question no document answers and only the
// client can. One sentence from them unblocks a transaction that would
// otherwise sit uncategorised until somebody phones about it.
//
// DELIBERATELY THE SAME CARD SHAPE as a document item, sitting in the same
// list, in the order the firm asked. It is another thing the client owes; it is
// not a new section, a new screen, or a new idea they have to learn. The only
// difference is the control: a text box where the dropzone would be.
//
// ONCE ANSWERED, THE ANSWER STAYS ON SCREEN. A client who wrote three sentences
// about a deposit last week should be able to see that they did, and what they
// said. Nothing here lets them edit it afterwards — the firm may already have
// coded the entry on the strength of it, and a silently-changing answer under a
// booked transaction is worse than no answer.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Check, HelpCircle, Loader2, AlertTriangle } from "lucide-react";
import type { RequestItem } from "@/lib/db/request-items";
import { logPortalActivity } from "@/lib/portal/activity-log";
import { pickItemText } from "@/lib/engagements/request-item-row";

type LocalState = "idle" | "sending" | "error";

export function QuestionItemCard({
  token,
  item,
  locale,
  onAnswered,
}: {
  token: string;
  item: RequestItem;
  locale: "fr" | "en";
  onAnswered: (answer: string) => void;
}) {
  const t = useTranslations("Portal");
  const [local, setLocal] = useState<LocalState>("idle");
  const [draft, setDraft] = useState("");
  // The answer as it stands: whatever came from the server, or what we just
  // sent. Held locally so the card settles immediately rather than waiting for
  // a refresh the client did not ask for.
  const [answer, setAnswer] = useState<string | null>(
    item.answer_text?.trim() ? item.answer_text : null,
  );

  const label = pickItemText(locale, item.label_fr, item.label);
  const description = pickItemText(
    locale,
    item.description_fr,
    item.description,
  );

  const answered = Boolean(answer);
  const canSend = draft.trim().length > 0 && local !== "sending";

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setLocal("sending");
    try {
      const res = await fetch("/api/portal/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, item_id: item.id, answer: text }),
      });
      if (!res.ok) {
        setLocal("error");
        return;
      }
      setAnswer(text);
      setDraft("");
      setLocal("idle");
      onAnswered(text);
      logPortalActivity(token, "client_answered_question", {
        name: label,
        ref: item.id,
      });
    } catch {
      setLocal("error");
    }
  }

  return (
    <div
      className={cn(
        "group rounded-xl border p-4 transition-all duration-200 sm:p-5",
        answered
          ? "border-success/30 bg-success/[0.04]"
          : "border-border/60 bg-card/40 hover:border-border hover:bg-card hover:shadow-sm",
      )}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <span
          className={cn(
            "mt-0.5 shrink-0",
            answered ? "text-success" : "text-muted-foreground",
          )}
        >
          {answered ? (
            <Check className="size-5" aria-hidden />
          ) : (
            <HelpCircle className="size-5" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-medium leading-snug text-foreground">
            {label}
          </h3>
          {description && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}

          {answered ? (
            <div className="mt-3 rounded-lg border border-success/30 bg-success/[0.08] px-3 py-2.5 text-sm">
              <div className="flex items-center gap-1.5 font-medium text-success">
                <Check className="size-4 shrink-0" aria-hidden />
                {t("question_thanks")}
              </div>
              {/* Their own words, kept visible. whitespace-pre-line so a client
                  who pressed enter twice sees the paragraphs they typed. */}
              <p className="mt-1 whitespace-pre-line text-foreground/80">
                {answer}
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <label htmlFor={`answer-${item.id}`} className="sr-only">
                {t("question_placeholder")}
              </label>
              <textarea
                id={`answer-${item.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                placeholder={t("question_placeholder")}
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              />
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={send} disabled={!canSend}>
                  {local === "sending" && (
                    <Loader2
                      className="mr-1.5 size-3.5 animate-spin"
                      aria-hidden
                    />
                  )}
                  {t("question_send")}
                </Button>
                {local === "error" && (
                  <span className="flex items-center gap-1.5 text-sm text-warning">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden />
                    {t("question_failed")}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

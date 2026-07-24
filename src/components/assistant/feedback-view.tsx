"use client";

import { useActionState, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  submitFeedbackAction,
  type FeedbackState,
} from "@/app/actions/feedback";

// The "send feedback" form, reachable from the chat footer link. Extracted
// verbatim from the old assistant panel's chat-tab so it outlives the panel and
// can be reused by the popup launcher's AI chat.
export function FeedbackView({ onBack }: { onBack: () => void }) {
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

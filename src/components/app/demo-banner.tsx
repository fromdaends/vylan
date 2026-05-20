"use client";

import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { BookCallButton } from "@/components/booking/book-call-button";

// Slim one-line strip at the top of the in-app shell while
// `firm.is_demo = true`. Designed to be peripheral, not intrusive —
// it tells the visitor where they are and offers two ways to convert
// (Book a call via Cal.com / Buy now mailto) without dominating the
// viewport.
export function DemoBanner() {
  const t = useTranslations("Demo");
  return (
    <div className="bg-accent/10 border-b border-accent/20 text-xs">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-1.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="h-3 w-3 text-accent shrink-0" aria-hidden />
          <span className="font-medium">{t("banner_title")}</span>
        </div>
        <div className="flex items-center gap-2">
          <BookCallButton
            label={t("banner_cta_book")}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
          />
          <a
            href="mailto:hello@relai.app?subject=Ready%20to%20subscribe"
            className="font-medium px-2 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {t("banner_cta_buy")}
          </a>
        </div>
      </div>
    </div>
  );
}

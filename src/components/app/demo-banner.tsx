"use client";

import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";

// Persistent banner shown at the top of the in-app shell whenever
// the current firm has `is_demo = true`. Two CTAs:
//   - Primary: "Talk pricing" → mailto with subject so the founder
//     can prioritize pricing chats in their inbox.
//   - Secondary: "Buy now" → mailto with a different subject ("ready
//     to subscribe") to surface high-intent leads when billing is off.
// Both mailtos go to the same inbox; the subject is the signal.
export function DemoBanner() {
  const t = useTranslations("Demo");
  return (
    <div className="bg-accent/10 border-b border-accent/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-accent shrink-0" aria-hidden />
          <span className="font-medium">{t("banner_title")}</span>
          <span className="text-muted-foreground hidden sm:inline">
            · {t("banner_body")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="mailto:hello@relai.app?subject=Pricing%20chat"
            className="text-xs font-medium text-primary hover:underline"
          >
            {t("banner_cta_talk")}
          </a>
          <span className="text-muted-foreground/40" aria-hidden>
            ·
          </span>
          <a
            href="mailto:hello@relai.app?subject=Ready%20to%20subscribe"
            className="text-xs font-medium px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            {t("banner_cta_buy")}
          </a>
        </div>
      </div>
    </div>
  );
}

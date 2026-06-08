"use client";

import { useTranslations } from "next-intl";
import { Sparkles, Lock } from "lucide-react";
import { BookCallButton } from "@/components/booking/book-call-button";

// Owner-only card at the top of /settings while the firm is on the free trial.
// Replaces the old self-serve "go live" card (which let a trial firm flip
// itself to a live/paid account for free). Conversion is now founder-led —
// talk pricing on a call, then we set them up — so this card just surfaces
// trial status and a booking CTA, never a free self-upgrade.
export function TrialStatusCard({
  expired,
  daysLeft,
}: {
  expired: boolean;
  daysLeft: number | null;
}) {
  const t = useTranslations("Settings");

  if (expired) {
    return (
      <section className="rounded-xl border border-destructive/40 bg-destructive/[0.06] p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-destructive/15 text-destructive shrink-0">
            <Lock className="h-4 w-4" />
          </span>
          <div className="flex-1 space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-destructive">
                {t("trial_card_expired_title")}
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("trial_card_expired_body")}
              </p>
            </div>
            <BookCallButton label={t("trial_card_cta_book")} size="sm" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-accent/40 bg-accent/[0.06] p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-accent/15 text-accent shrink-0">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="flex-1 space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">
              {daysLeft != null
                ? t("trial_card_title", { days: daysLeft })
                : t("trial_card_title_no_days")}
            </h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("trial_card_body")}
            </p>
          </div>
          <BookCallButton
            label={t("trial_card_cta_pricing")}
            size="sm"
            variant="outline"
          />
        </div>
      </div>
    </section>
  );
}

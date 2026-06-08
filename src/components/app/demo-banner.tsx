"use client";

import { useTranslations } from "next-intl";
import { Sparkles, Lock } from "lucide-react";
import { BookCallButton } from "@/components/booking/book-call-button";

// Top-of-app strip shown while a firm is on the free trial (firm.is_demo).
// Two states:
//   * active  — "You're on a free trial · N days left" + Contact us for pricing
//   * expired — assertive "Your free trial has ended" + Book a meeting (the
//               app's write actions are also locked at this point; see the
//               trial gate in clients/engagements + plan-limits).
// The "Contact us for pricing" / "Book a meeting" CTA opens the Cal.com
// booking modal in-app via BookCallButton.
export function TrialBanner({
  expired,
  daysLeft,
}: {
  expired: boolean;
  daysLeft: number | null;
}) {
  const t = useTranslations("Demo");

  if (expired) {
    return (
      <div className="bg-destructive/10 border-b border-destructive/30 text-xs">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <Lock className="h-3.5 w-3.5 text-destructive shrink-0" aria-hidden />
            <span className="font-semibold text-destructive">
              {t("trial_expired_banner")}
            </span>
          </div>
          <BookCallButton
            label={t("trial_cta_book")}
            variant="default"
            size="sm"
            className="h-7 px-2.5 text-xs shrink-0"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-accent/10 border-b border-accent/20 text-xs">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-1.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="h-3 w-3 text-accent shrink-0" aria-hidden />
          <span className="font-medium truncate">
            {t("trial_banner")}
            {daysLeft != null && (
              <span className="text-muted-foreground">
                {" · "}
                {t("trial_days_left", { days: daysLeft })}
              </span>
            )}
          </span>
        </div>
        <BookCallButton
          label={t("trial_cta_pricing")}
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs shrink-0"
        />
      </div>
    </div>
  );
}

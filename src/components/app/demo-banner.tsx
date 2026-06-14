"use client";

import { useTranslations } from "next-intl";
import { Sparkles, Lock } from "lucide-react";
import { BookCallButton } from "@/components/booking/book-call-button";

// Top-of-app strip shown while a firm is on the free trial (firm.is_demo).
// States, in priority order:
//   * expired       — assertive "Your free trial has ended" + Book a meeting
//                     (write actions are also locked; see the trial gate in
//                     clients/engagements + plan-limits).
//   * aiLimitReached — trial still running, but the firm used up its small
//                     lifetime AI quota (see TRIAL_AI_TOTAL_CAP). AI document
//                     analysis is paused; everything else still works. Upgrade
//                     to lift it.
//   * active        — "You're on a free trial · N days left" + Contact us for pricing
// The CTA opens the Cal.com booking modal in-app via BookCallButton.
export function TrialBanner({
  expired,
  daysLeft,
  aiLimitReached = false,
}: {
  expired: boolean;
  daysLeft: number | null;
  aiLimitReached?: boolean;
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

  // Trial still active, but the lifetime AI quota is used up — AI document
  // analysis is paused (uploads + manual review still work). Amber, between the
  // calm "active" strip and the red "expired" one.
  if (aiLimitReached) {
    return (
      <div className="bg-warning/10 border-b border-warning/30 text-xs">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <Sparkles className="h-3.5 w-3.5 text-warning shrink-0" aria-hidden />
            {/* No truncate — the message must stay readable on narrow screens;
                it wraps to a second line rather than getting cut off. */}
            <span className="font-semibold text-warning" title={t("ai_limit_banner")}>
              {t("ai_limit_banner")}
            </span>
          </div>
          <BookCallButton
            label={t("ai_limit_cta")}
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

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// Personalized "Good morning, Zach." greeting at the top of the
// dashboard. The time-of-day part is computed client-side from the
// user's local clock (the user's machine, not the server timezone or
// the firm timezone — important when the accountant is travelling).
//
// SSR renders a stable "welcome" fallback so there's no hydration
// mismatch; the useEffect upgrades to the time-aware version on mount.
// The fallback only shows for one paint, then settles.
export function DashboardGreeting({
  firstName,
  subtitle,
}: {
  firstName: string | null;
  subtitle: string;
}) {
  const t = useTranslations("Dashboard");
  const [greeting, setGreeting] = useState<string | null>(null);

  useEffect(() => {
    const hour = new Date().getHours();
    let key: "greeting_morning" | "greeting_afternoon" | "greeting_evening" | "greeting_night";
    if (hour < 5) key = "greeting_night";
    else if (hour < 12) key = "greeting_morning";
    else if (hour < 18) key = "greeting_afternoon";
    else if (hour < 22) key = "greeting_evening";
    else key = "greeting_night";
    setGreeting(t(key));
  }, [t]);

  const headline = greeting ?? t("greeting_welcome");
  // Append a comma + name when we have one. Use a thin period so the
  // line reads conversationally without feeling stiff.
  const withName = firstName ? `${headline}, ${firstName}.` : `${headline}.`;

  return (
    <div className="space-y-2 animate-in-up">
      <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
        {withName}
      </h1>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

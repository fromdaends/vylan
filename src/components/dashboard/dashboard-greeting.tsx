"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

type GreetingKey =
  | "greeting_morning"
  | "greeting_afternoon"
  | "greeting_evening"
  | "greeting_night";

// Time-of-day greeting key from the user's LOCAL clock. Used only as the
// client snapshot below (runs in the client render phase after hydration),
// never on the server — so reading the machine's local hour here is safe.
function localGreetingKey(): GreetingKey {
  const hour = new Date().getHours();
  if (hour < 5) return "greeting_night";
  if (hour < 12) return "greeting_morning";
  if (hour < 18) return "greeting_afternoon";
  if (hour < 22) return "greeting_evening";
  return "greeting_night";
}

// There is no external store to watch — the greeting only needs to be
// read once the client takes over after hydration. So the subscribe
// callback is a no-op that returns an empty unsubscribe.
const subscribeNever = () => () => {};

// Personalized "Good morning, Zach." greeting at the top of the
// dashboard. The time-of-day part is computed client-side from the
// user's local clock (the user's machine, not the server timezone or
// the firm timezone — important when the accountant is travelling).
//
// Hydration safety: useSyncExternalStore renders the SERVER snapshot
// (null → the stable "welcome" fallback) on the server AND on the
// client's first paint, so the two match and there's no hydration
// mismatch. React then swaps to the CLIENT snapshot (the local-hour
// greeting) right after hydration. Same fallback-then-upgrade behavior
// the previous effect+state version had, but computed during render with
// no effect and no setState (satisfies react-hooks/set-state-in-effect).
export function DashboardGreeting({
  firstName,
  subtitle,
  variant = "default",
}: {
  firstName: string | null;
  subtitle: string;
  // "default" — the standard heading scale, used on the dashboard header.
  // "hero"    — a larger 4xl/5xl scale for a more prominent landing surface.
  variant?: "default" | "hero";
}) {
  const t = useTranslations("Dashboard");
  const greetingKey = useSyncExternalStore<GreetingKey | null>(
    subscribeNever,
    localGreetingKey, // client snapshot: local time-of-day greeting
    () => null, // server snapshot + first client paint: stable fallback
  );

  const headline = greetingKey ? t(greetingKey) : t("greeting_welcome");
  // Append a comma + name when we have one. Use a thin period so the
  // line reads conversationally without feeling stiff.
  const withName = firstName ? `${headline}, ${firstName}.` : `${headline}.`;

  const headingClass =
    variant === "hero"
      ? "text-4xl sm:text-5xl lg:text-[3.25rem] font-semibold tracking-tight text-foreground leading-[1.05]"
      : "text-3xl sm:text-4xl font-semibold tracking-tight text-foreground";
  const subtitleClass =
    variant === "hero"
      ? "text-base text-muted-foreground"
      : "text-sm text-muted-foreground";

  return (
    <div className="space-y-2 animate-in-up">
      <h1 className={headingClass}>{withName}</h1>
      <p className={subtitleClass}>{subtitle}</p>
    </div>
  );
}

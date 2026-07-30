"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Sparkles, X, ChevronRight } from "lucide-react";
import { formatRelative, type AppLocale } from "@/lib/format";
import type { HomeNotification } from "@/lib/home/notifications";

// Team Wave 2 — "While you were away". A calm, dismissible welcome-back banner
// that highlights what changed SINCE THE VIEWER LAST LOOKED (per device). Reuses
// the dashboard's existing home notifications (the same data behind the What's-
// new bell); the only new state is a localStorage "last seen" timestamp, so no
// migration and it works immediately.
//
// Semantics (GitHub-style): we take the stored last-seen as this visit's
// baseline, show the notifications newer than it, and stamp "now" so a later
// visit only shows what's newer still. The FIRST ever visit (no stored value)
// shows nothing — we just record the baseline rather than dumping the history.

const SEEN_KEY = "vylan:home-seen-at";
const MAX_ITEMS = 6;

// The stored last-seen stamp, or null when there is nothing usable to compare
// against: the first ever visit, a corrupted value, or storage blocked entirely
// (private mode). All three mean the same thing here — show nothing.
function readSeenAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

// Nothing to subscribe to: the baseline is captured once per mount and then
// deliberately never changes. A stable no-op unsubscribe keeps
// useSyncExternalStore from resubscribing on every render.
const subscribeNever = () => () => {};

export function WhileYouWereAway({
  notifications,
  locale,
}: {
  notifications: HomeNotification[];
  locale: AppLocale;
}) {
  const t = useTranslations("Home");
  const [dismissed, setDismissed] = useState(false);

  // The baseline is FROZEN for the life of this mount, captured by the lazy
  // initialiser on the first render — before the effect below overwrites the
  // stored stamp. That ordering is the whole trick: the effect writes the very
  // key this reads, so anything that re-read localStorage afterwards would come
  // back as "now" a beat after mount and the banner would erase itself the
  // instant it appeared. Never call setBaseline.
  const [baseline] = useState(readSeenAt);

  // Hydration safety: the server — and the client's first paint — get the false
  // snapshot and render nothing, so the two agree; React swaps in the real
  // baseline immediately after hydration. This is the same reveal the mount
  // effect used to do with setState, minus the cascading render (satisfies
  // react-hooks/set-state-in-effect), and matches DashboardGreeting next door.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const seenAt = hydrated ? baseline : null;

  // Stamp "now" so the NEXT visit measures from here. This visit keeps
  // measuring against the baseline captured above.
  useEffect(() => {
    try {
      window.localStorage.setItem(SEEN_KEY, new Date().toISOString());
    } catch {
      // ignore (private mode / disabled storage) — banner just won't persist.
    }
  }, []);

  // Derived during render rather than stored: an empty list covers both "not
  // resolved yet" and "nothing new", and both render nothing.
  const newItems = useMemo(() => {
    if (seenAt == null) return [];
    return notifications
      .filter((n) => {
        const ts = Date.parse(n.timestamp);
        return !Number.isNaN(ts) && ts > seenAt;
      })
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }, [notifications, seenAt]);

  if (dismissed || newItems.length === 0) return null;

  const shown = newItems.slice(0, MAX_ITEMS);
  const extra = newItems.length - shown.length;

  return (
    <section
      aria-labelledby="while-away-title"
      className="rounded-xl border border-accent/30 bg-accent/[0.06] p-4 animate-in-up"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden />
          <h2 id="while-away-title" className="text-sm font-semibold">
            {t("while_away_title", { count: newItems.length })}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t("while_away_dismiss")}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <ul className="mt-3 divide-y divide-border/40">
        {shown.map((n) => (
          <li key={n.id}>
            <Link
              href={n.href}
              onClick={() => setDismissed(true)}
              className="group flex items-center gap-2 py-2 text-sm hover:underline"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">
                  {t(`kind_${n.kind}` as Parameters<typeof t>[0])}
                </span>
                {n.engagement_title && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {n.engagement_title}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatRelative(n.timestamp, locale)}
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>

      {extra > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("while_away_more", { count: extra })}
        </p>
      )}
    </section>
  );
}

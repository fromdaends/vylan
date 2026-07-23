"use client";

import { useEffect, useState } from "react";
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
// Semantics (GitHub-style): on mount we read the stored last-seen, compute the
// notifications newer than it, and immediately stamp "now" so a later visit only
// shows what's newer still. The FIRST ever visit (no stored value) shows nothing
// — we just record the baseline rather than dumping the whole history.

const SEEN_KEY = "vylan:home-seen-at";
const MAX_ITEMS = 6;

export function WhileYouWereAway({
  notifications,
  locale,
}: {
  notifications: HomeNotification[];
  locale: AppLocale;
}) {
  const t = useTranslations("Home");
  // null until the mount effect resolves the baseline; [] means "nothing new".
  const [newItems, setNewItems] = useState<HomeNotification[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let seenAt: number | null = null;
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      seenAt = raw ? Date.parse(raw) : null;
    } catch {
      seenAt = null;
    }
    // Stamp "now" so the next visit measures from here (this visit still shows
    // whatever we computed against the previous baseline).
    try {
      localStorage.setItem(SEEN_KEY, new Date().toISOString());
    } catch {
      // ignore (private mode / disabled storage) — banner just won't persist.
    }
    // First-ever visit: record the baseline, show nothing.
    if (seenAt == null || Number.isNaN(seenAt)) {
      setNewItems([]);
      return;
    }
    const fresh = notifications
      .filter((n) => {
        const ts = Date.parse(n.timestamp);
        return !Number.isNaN(ts) && ts > seenAt!;
      })
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    setNewItems(fresh);
  }, [notifications]);

  if (dismissed || newItems == null || newItems.length === 0) return null;

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

"use client";

// THE FEED — every event on the platform, newest first.
//
// This is the tab the whole feature was asked for: "as much activity as
// possible". So the rule here is that nothing is hidden by default. The filters
// narrow, they never pre-narrow: you land on everything and cut down from
// there, because a console that quietly starts filtered will one day be the
// reason nobody noticed something.
//
// Grouped by day rather than rendered as one 400-row list — a timestamp column
// repeating "Aug 6" four hundred times is noise, and the day heading is the
// thing the eye actually navigates by.

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import {
  ACTIVITY_CATEGORIES,
  CATEGORY_DOT,
  activityCategory,
  humaniseAction,
  type ActivityCategory,
} from "@/lib/founders/actions";
import { dayKey, matchesQuery } from "@/lib/founders/aggregate";
import type { FeedEvent } from "@/lib/founders/types";

/** Up to three scalar metadata entries, short enough to sit on the row.
 *  Objects and arrays are skipped rather than JSON-dumped — a row that wraps
 *  to six lines because one event carried a nested payload destroys the scan. */
export function metadataGlimpse(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(metadata)) {
    if (parts.length >= 3) break;
    if (v === null || v === undefined) continue;
    if (typeof v === "object") continue;
    const text = String(v);
    if (!text || text.length > 60) continue;
    parts.push(`${k}: ${text}`);
  }
  return parts.join(" · ");
}

function timeOfDay(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
}

function dayHeading(day: string, locale: string): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return day;
  // Assembled from single-part formats on purpose — one combined format orders
  // weekday and month by locale and has produced "August Monday" here before.
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(d);
  const month = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(d);
  const dayNum = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(d);
  return `${weekday} ${dayNum} ${month}`;
}

export function ActivityFeed({
  events,
  locale,
  /** The per-firm page already says which firm you are looking at. */
  showFirm = true,
  /** Rendered inside a fixed-height rail on the Overview. */
  compact = false,
}: {
  events: FeedEvent[];
  locale: string;
  showFirm?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("Founders");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ActivityCategory | "all">("all");
  const [actor, setActor] = useState<"all" | "user" | "client" | "system">("all");

  const withCategory = useMemo(
    () => events.map((e) => ({ event: e, category: activityCategory(e.action) })),
    [events],
  );

  // Counts come off the UNFILTERED list so a chip never disappears just because
  // the current filter excludes it — a filter row that rearranges itself as you
  // use it is unusable.
  const categoryCounts = useMemo(() => {
    const out: Partial<Record<ActivityCategory, number>> = {};
    for (const { category: c } of withCategory) out[c] = (out[c] ?? 0) + 1;
    return out;
  }, [withCategory]);

  const filtered = useMemo(
    () =>
      withCategory.filter(({ event, category: c }) => {
        if (category !== "all" && c !== category) return false;
        if (actor !== "all" && event.actorType !== actor) return false;
        if (!query.trim()) return true;
        return matchesQuery(
          [event.firmName, event.action, humaniseAction(event.action), event.actorName ?? ""].join(
            " ",
          ),
          query,
        );
      }),
    [withCategory, category, actor, query],
  );

  const days = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    for (const row of filtered) {
      const key = dayKey(row.event.createdAt);
      const list = groups.get(key);
      if (list) list.push(row);
      else groups.set(key, [row]);
    }
    return [...groups.entries()];
  }, [filtered]);

  const activeCategories = ACTIVITY_CATEGORIES.filter((c) => (categoryCounts[c] ?? 0) > 0);

  return (
    <div className="flex min-h-0 flex-col">
      {!compact && (
        <div className="mb-4 space-y-3">
          {/* Search — the same minimal one-row treatment as the message inbox:
              an icon, a borderless input and a hairline. No box, no button. */}
          <div className="flex items-center gap-2 border-b border-border/60 py-1">
            <Search className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Escape clears; a deliberate no-op when already empty so a
                // parent panel can still close on the same key.
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder={t("feed_search_placeholder")}
              className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("feed_search_clear")}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip
              label={t("feed_all")}
              count={events.length}
              active={category === "all"}
              onClick={() => setCategory("all")}
            />
            {activeCategories.map((c) => (
              <FilterChip
                key={c}
                label={t(`category_${c}`)}
                count={categoryCounts[c] ?? 0}
                dot={CATEGORY_DOT[c]}
                active={category === c}
                onClick={() => setCategory(category === c ? "all" : c)}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t("feed_actor")}</span>
            {(["all", "user", "client", "system"] as const).map((a) => (
              <FilterChip
                key={a}
                label={a === "all" ? t("feed_all") : t(`actor_${a}`)}
                active={actor === a}
                onClick={() => setActor(a)}
              />
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {events.length === 0 ? t("feed_empty") : t("feed_no_matches")}
        </p>
      ) : (
        <div className={cn("min-h-0", compact ? "space-y-2" : "space-y-6 overflow-y-auto")}>
          {days.map(([day, rows]) => (
            <section key={day}>
              {!compact && (
                <h4 className="sticky top-0 z-10 bg-card/95 py-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {dayHeading(day, locale)}
                  <span className="ml-2 font-normal normal-case tabular-nums opacity-70">
                    {rows.length}
                  </span>
                </h4>
              )}
              <ul className="divide-y divide-border/50">
                {rows.map(({ event, category: c }) => (
                  <li key={event.id} className="flex items-start gap-3 py-2">
                    <span
                      className={cn("mt-1.5 size-2 shrink-0 rounded-full", CATEGORY_DOT[c])}
                      title={t(`category_${c}`)}
                      aria-hidden
                    />
                    <time
                      dateTime={event.createdAt}
                      title={event.createdAt}
                      className="w-11 shrink-0 pt-px text-xs tabular-nums text-muted-foreground"
                    >
                      {timeOfDay(event.createdAt, locale)}
                    </time>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        <span className="font-medium">{humaniseAction(event.action)}</span>
                        {event.actorName && (
                          <span className="text-muted-foreground"> · {event.actorName}</span>
                        )}
                        {!event.actorName && event.actorType !== "user" && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {t(`actor_${event.actorType}`)}
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {showFirm && (
                          <Link
                            href={`/founders/firms/${event.firmId}`}
                            className="hover:text-foreground hover:underline"
                          >
                            {event.firmName}
                          </Link>
                        )}
                        {showFirm && metadataGlimpse(event.metadata) && " · "}
                        {metadataGlimpse(event.metadata)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  count,
  dot,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  dot?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-foreground/25 bg-secondary font-medium text-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />}
      {label}
      {count != null && <span className="tabular-nums opacity-60">{count}</span>}
    </button>
  );
}

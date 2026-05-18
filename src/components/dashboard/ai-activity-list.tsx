"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ChevronRight, Search, Sparkles, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatRelative, type AppLocale } from "@/lib/format";
import type { AiActivityEntry } from "@/lib/db/ai-activity";
import {
  aiActionTone,
  aiActivityShortLabel,
} from "./ai-activity-shared";

// Client-side list with a "Search client" filter. Search is case-
// insensitive substring match on the client display_name; the list
// renders all entries when the input is empty. Entries are already
// scoped to the last 7 days by the server, so the section auto-resets
// every week without any client-side date math.
export function AiActivityList({
  entries,
  locale,
}: {
  entries: AiActivityEntry[];
  locale: AppLocale;
}) {
  const t = useTranslations("Attention");
  const [query, setQuery] = useState("");

  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!trimmed) return entries;
    return entries.filter((e) =>
      (e.client_display_name ?? "").toLowerCase().includes(trimmed),
    );
  }, [entries, trimmed]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 pointer-events-none"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("ai_activity_search_placeholder")}
          className="pl-8 pr-9 h-9 text-sm"
          aria-label={t("ai_activity_search_placeholder")}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("ai_activity_search_clear")}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          {t("ai_activity_no_matches", { query })}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {filtered.map((e) => (
            <AiActivityRow key={e.id} entry={e} locale={locale} t={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AiActivityRow({
  entry,
  locale,
  t,
}: {
  entry: AiActivityEntry;
  locale: AppLocale;
  t: ReturnType<typeof useTranslations<"Attention">>;
}) {
  const label = aiActivityShortLabel(entry.action, t);
  const tone = aiActionTone(entry.action);
  const href = entry.engagement_id
    ? `/engagements/${entry.engagement_id}`
    : null;
  const row = (
    <div className="flex items-start gap-3 py-3 px-1 -mx-1 rounded-md group">
      <Sparkles className={"h-3.5 w-3.5 mt-1 shrink-0 " + tone} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-snug truncate">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {entry.engagement_title && (
            <span className="truncate max-w-[18rem]">
              {entry.engagement_title}
            </span>
          )}
          {entry.client_display_name && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate max-w-[14rem]">
                {entry.client_display_name}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{formatRelative(entry.created_at, locale)}</span>
        </div>
      </div>
      {href && (
        <ChevronRight
          className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors mt-1.5 shrink-0"
          aria-hidden
        />
      )}
    </div>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="block hover:bg-secondary/40 transition-colors rounded-md"
        >
          {row}
        </Link>
      ) : (
        row
      )}
    </li>
  );
}

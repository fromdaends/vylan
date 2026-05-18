"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Clock,
  FileWarning,
  CheckCheck,
  ChevronRight,
  Inbox,
  Sparkles,
} from "lucide-react";
import { formatRelative } from "@/lib/format";

// Single source of truth for every engagement row the dashboard shows.
// Computed on the server and passed in plain-JSON form so this Client
// Component can stay small.
export type EngagementRow = {
  id: string;
  title: string;
  status: "draft" | "sent" | "in_progress" | "complete" | "cancelled";
  clientId: string;
  clientName: string;
  // Lanes
  isOverdue: boolean;
  daysOverdue: number | null;
  isDueSoon: boolean;
  daysUntilDue: number | null;
  isStale: boolean;
  daysSinceActivity: number | null;
  isReadyToReview: boolean;
  itemsReadyToReview: number;
  aiFlaggedCount: number;
  lastFlagAt: string | null;
};

type Filter =
  | "all"
  | "active"
  | "needs_attention"
  | "ready_to_review"
  | "ai_flagged"
  | "drafts";

const FILTER_HASHES: Record<Filter, string> = {
  all: "",
  active: "active",
  needs_attention: "needs-attention",
  ready_to_review: "ready-to-review",
  ai_flagged: "ai-flagged",
  drafts: "drafts",
};

function filterFromHash(hash: string): Filter {
  const clean = hash.replace(/^#/, "");
  const found = (Object.entries(FILTER_HASHES) as [Filter, string][]).find(
    ([, h]) => h === clean,
  );
  return found ? found[0] : "all";
}

export function EngagementList({ rows }: { rows: EngagementRow[] }) {
  const t = useTranslations("App");
  const tStatus = useTranslations("Status");
  const tAttention = useTranslations("Attention");
  const [filter, setFilter] = useState<Filter>("all");
  const [locale, setLocale] = useState<"fr" | "en">("en");

  // Initial filter from URL hash (so the metric tiles' anchor links
  // double as "click to filter") + sync on hash changes.
  useEffect(() => {
    const apply = () => setFilter(filterFromHash(window.location.hash));
    apply();
    setLocale(
      document.documentElement.lang === "fr" ? "fr" : "en",
    );
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  const counts = useMemo(() => {
    return {
      all: rows.length,
      active: rows.filter((r) => r.status === "sent" || r.status === "in_progress")
        .length,
      needs_attention: rows.filter((r) => r.isOverdue || r.isDueSoon || r.isStale)
        .length,
      ready_to_review: rows.filter((r) => r.isReadyToReview).length,
      ai_flagged: rows.filter((r) => r.aiFlaggedCount > 0).length,
      drafts: rows.filter((r) => r.status === "draft").length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    let r = rows;
    switch (filter) {
      case "active":
        r = r.filter((x) => x.status === "sent" || x.status === "in_progress");
        break;
      case "needs_attention":
        r = r.filter((x) => x.isOverdue || x.isDueSoon || x.isStale);
        break;
      case "ready_to_review":
        r = r.filter((x) => x.isReadyToReview);
        break;
      case "ai_flagged":
        r = r.filter((x) => x.aiFlaggedCount > 0);
        break;
      case "drafts":
        r = r.filter((x) => x.status === "draft");
        break;
    }
    return [...r].sort((a, b) => urgency(b) - urgency(a));
  }, [rows, filter]);

  function setFilterAndHash(next: Filter) {
    setFilter(next);
    const hash = FILTER_HASHES[next];
    history.replaceState(null, "", hash ? `#${hash}` : window.location.pathname);
  }

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: t("filter_all"), count: counts.all },
    {
      key: "needs_attention",
      label: tAttention("needs_attention"),
      count: counts.needs_attention,
    },
    {
      key: "ready_to_review",
      label: tAttention("ready_to_review"),
      count: counts.ready_to_review,
    },
    {
      key: "ai_flagged",
      label: t("filter_ai_flagged"),
      count: counts.ai_flagged,
    },
    { key: "active", label: t("filter_active"), count: counts.active },
    { key: "drafts", label: t("filter_drafts"), count: counts.drafts },
  ];

  return (
    <div className="rounded-xl border border-border bg-card animate-in-up">
      {/* Filter chips bar */}
      <div className="border-b border-border/60 px-3 py-3 flex flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const active = c.key === filter;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilterAndHash(c.key)}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60")
              }
            >
              <span>{c.label}</span>
              <span
                className={
                  "tabular-nums font-mono " +
                  (active ? "text-foreground" : "text-muted-foreground/60")
                }
              >
                {c.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <ul className="divide-y divide-border/60 px-5">
          {filtered.map((r) => (
            <li key={r.id}>
              <Link
                href={`/engagements/${r.id}`}
                className="flex items-center justify-between gap-3 py-3.5 px-1 -mx-1 rounded-md hover:bg-secondary/40 transition-colors group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">
                      {r.title}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      · {r.clientName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {/* Lane badges — an engagement can have several. */}
                    {r.isOverdue && r.daysOverdue != null && (
                      <Badge variant="destructive" className="font-normal">
                        <AlertTriangle className="h-3 w-3" />
                        {tAttention("overdue_by", { days: r.daysOverdue })}
                      </Badge>
                    )}
                    {r.isDueSoon && r.daysUntilDue != null && (
                      <Badge variant="secondary" className="font-normal">
                        <Clock className="h-3 w-3" />
                        {tAttention("due_in", { days: r.daysUntilDue })}
                      </Badge>
                    )}
                    {r.isStale && r.daysSinceActivity != null && (
                      <Badge variant="outline" className="font-normal">
                        <FileWarning className="h-3 w-3" />
                        {tAttention("stale_days", {
                          days: r.daysSinceActivity,
                        })}
                      </Badge>
                    )}
                    {r.isReadyToReview && (
                      <Badge variant="secondary" className="font-normal">
                        <Inbox className="h-3 w-3" />
                        {tAttention("items_ready", {
                          count: r.itemsReadyToReview,
                        })}
                      </Badge>
                    )}
                    {r.aiFlaggedCount > 0 && (
                      <Badge variant="outline" className="font-normal text-warning border-warning/40">
                        <Sparkles className="h-3 w-3" />
                        {tAttention("ai_flagged_count", {
                          count: r.aiFlaggedCount,
                        })}
                      </Badge>
                    )}
                    {/* No lanes → fall back to the engagement status. */}
                    {!r.isOverdue &&
                      !r.isDueSoon &&
                      !r.isStale &&
                      !r.isReadyToReview &&
                      r.aiFlaggedCount === 0 && (
                        <Badge
                          variant={statusBadgeVariant(r.status)}
                          className="font-normal"
                        >
                          {tStatus(r.status)}
                        </Badge>
                      )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r.lastFlagAt && r.aiFlaggedCount > 0 && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap hidden md:inline">
                      {formatRelative(r.lastFlagAt, locale)}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  const t = useTranslations("App");
  const tAttention = useTranslations("Attention");
  const message =
    filter === "needs_attention"
      ? tAttention("empty_attention")
      : filter === "ready_to_review"
        ? tAttention("empty_review")
        : filter === "ai_flagged"
          ? tAttention("empty_ai_rejected")
          : filter === "drafts"
            ? t("empty_drafts")
            : filter === "active"
              ? t("empty_active")
              : t("empty_all");
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
      <CheckCheck className="h-5 w-5 opacity-60" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "complete") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "draft") return "outline";
  return "secondary";
}

// Higher = more urgent. Mirrors lib/attention's attentionScore but
// extended with AI-flagged + ready-to-review so it's an all-purpose
// ranking for the unified list.
function urgency(r: EngagementRow): number {
  let s = 0;
  if (r.isOverdue && r.daysOverdue != null) s += 10000 + r.daysOverdue;
  if (r.isDueSoon) s += 5000;
  if (r.aiFlaggedCount > 0) s += 2000 + r.aiFlaggedCount * 10;
  if (r.isReadyToReview) s += 1500 + r.itemsReadyToReview * 5;
  if (r.isStale && r.daysSinceActivity != null) {
    s += 800 + r.daysSinceActivity * 3;
  }
  if (r.status === "sent" || r.status === "in_progress") s += 200;
  if (r.status === "draft") s += 50;
  return s;
}

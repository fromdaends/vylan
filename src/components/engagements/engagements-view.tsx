"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, Users } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WorklistTable,
  type WorklistRow,
} from "@/components/dashboard/engagements-worklist";
import { selectAssignedTo } from "@/lib/dashboard/worklist-select";
import { daysUntilPurge } from "@/lib/engagements/lifecycle";
import {
  ENGAGEMENT_VIEWS,
  viewLabelKey,
  type EngagementView,
} from "@/lib/engagements/views";
import { cn } from "@/lib/cn";
import type { AppLocale } from "@/lib/format";

// One All-Engagements sub-page. The server has already loaded + filtered the
// rows for `view`; this renders the in-page view switcher (pills — the primary
// nav on mobile, where the sidebar accordion isn't shown), a search box, and
// the shared WorklistTable. Recently Deleted gets an extra 30-day-policy note +
// a per-row "deleted in N days" countdown.
export function EngagementsView({
  view,
  rows,
  locale,
  canDelete,
  currentUserId,
  badges,
}: {
  view: EngagementView;
  rows: WorklistRow[];
  locale: AppLocale;
  canDelete: boolean;
  currentUserId: string | null;
  badges: { ready: number; deleted: number };
}) {
  const t = useTranslations("Engagements");
  const tDash = useTranslations("Dashboard");
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  // My/All engagements — mirrors the clients owner filter. Defaults to the
  // accountant's OWN work ("mine") when they're assigned at least one in this
  // view, else "all" so the list is never mysteriously empty. The choice is
  // then remembered per user (localStorage), which overrides this default.
  const ownsAny =
    !!currentUserId && rows.some((r) => r.assigneeUserId === currentUserId);
  const [scope, setScope] = useState<"mine" | "all">(ownsAny ? "mine" : "all");
  useEffect(() => {
    if (!currentUserId) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(`vylan:eng-scope:${currentUserId}`);
    } catch {
      saved = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "mine" || saved === "all") setScope(saved);
  }, [currentUserId]);
  const chooseScope = (s: "mine" | "all") => {
    setScope(s);
    if (currentUserId) {
      try {
        localStorage.setItem(`vylan:eng-scope:${currentUserId}`, s);
      } catch {
        /* ignore */
      }
    }
  };

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    let base =
      q !== ""
        ? rows.filter(
            (r) =>
              r.title.toLowerCase().includes(q) ||
              r.clientName.toLowerCase().includes(q),
          )
        : rows;
    if (scope === "mine") base = selectAssignedTo(base, currentUserId);
    return [...base].sort((a, b) => b.recencyAt.localeCompare(a.recencyAt));
  }, [rows, q, scope, currentUserId]);

  const badgeFor = (v: EngagementView): number | null => {
    if (v === "ready" && badges.ready > 0) return badges.ready;
    if (v === "deleted" && badges.deleted > 0) return badges.deleted;
    return null;
  };

  // The pills mirror the sidebar accordion (active sub-page highlighted) and
  // are the only way to switch views on mobile, where the sidebar is a bottom
  // tab bar. usePathname is locale-stripped by the i18n nav helper.
  const hrefFor = (v: EngagementView) =>
    v === "active" ? "/engagements" : `/engagements/${v}`;
  const isActive = (v: EngagementView) =>
    v === "active"
      ? pathname === "/engagements"
      : pathname === `/engagements/${v}`;

  return (
    <div className="space-y-5">
      <div
        role="tablist"
        aria-label={t("views_label")}
        className="flex flex-wrap items-center gap-1.5"
      >
        {ENGAGEMENT_VIEWS.map((v) => {
          const active = isActive(v);
          const count = badgeFor(v);
          return (
            <Link
              key={v}
              href={hrefFor(v)}
              role="tab"
              aria-selected={active}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-foreground shadow-[inset_0_1px_0_0_var(--color-border)]"
                  : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
              )}
            >
              {t(viewLabelKey(v))}
              {count != null && (
                <span
                  className={cn(
                    "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                    v === "deleted"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-accent/15 text-accent",
                  )}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Recently Deleted: surface the 30-day recovery policy up front so a
          finding-it-here user isn't surprised by the eventual purge. */}
      {view === "deleted" && (
        <p className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          {t("deleted_policy_note")}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select
          value={scope}
          onValueChange={(v) => chooseScope(v as "mine" | "all")}
        >
          <SelectTrigger
            size="sm"
            className="w-[13rem] self-start"
            aria-label={t("scope_label")}
          >
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue placeholder={t("scope_label")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("scope_all")}</SelectItem>
            <SelectItem value="mine">{t("scope_mine")}</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tDash("wl_search_placeholder")}
            aria-label={tDash("wl_search_placeholder")}
            className="h-9 pl-9"
          />
        </div>
      </div>

      <WorklistTable
        rows={visible}
        locale={locale}
        emptyText={q !== "" ? tDash("wl_empty_search") : t(`view_${view}_empty`)}
        canDelete={canDelete}
        countdownFor={
          view === "deleted"
            ? (r) =>
                r.deletedAt
                  ? t("deleted_in_days", {
                      days: daysUntilPurge(r.deletedAt, Date.now()),
                    })
                  : null
            : undefined
        }
      />
    </div>
  );
}

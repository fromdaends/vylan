"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
// useSearchParams is locale-agnostic, so it comes from next/navigation — but the
// ROUTER must be the i18n one. usePathname (i18n) returns a locale-STRIPPED path
// ("/engagements"), and feeding that to next/navigation's router navigates to the
// literal path, which under localePrefix:"as-needed" IS the default locale — so a
// French accountant clicking a filter chip gets thrown back into English. The
// i18n router re-applies the current locale prefix.
import { useSearchParams } from "next/navigation";
import { Link, usePathname } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import {
  WorklistTable,
  type WorklistRow,
} from "@/components/dashboard/engagements-worklist";
import { daysUntilPurge } from "@/lib/engagements/lifecycle";
import {
  ENGAGEMENT_VIEWS,
  viewLabelKey,
  type EngagementView,
} from "@/lib/engagements/views";
import {
  DIR_PARAM,
  SORT_PARAM,
  STAGE_PARAM,
  filterRowsByStage,
  parseStageFilter,
  parseStageSort,
  sortRowsByStage,
} from "@/lib/engagements/stage-filter";
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
  teamEnabled,
  assignMembers,
  firmId,
}: {
  view: EngagementView;
  rows: WorklistRow[];
  locale: AppLocale;
  canDelete: boolean;
  currentUserId: string | null;
  badges: { ready: number; deleted: number };
  teamEnabled: boolean;
  // Active teammates, so a row can be handed to somebody from its menu. Doubles
  // as the presence roster — the only source of names for a live face on a row.
  assignMembers?: { id: string; name: string }[];
  // Enables live presence on the rows. Absent → no subscription, no faces.
  firmId?: string | null;
}) {
  const t = useTranslations("Engagements");
  const tDash = useTranslations("Dashboard");
  const tStage = useTranslations("Stage");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");

  // Read-only now. Nothing on this page WRITES ?stage= or ?sort= any more —
  // both became column menus on the table — but a link shared before that still
  // opens in the order and the slice it promised, instead of quietly showing
  // something else.
  const stageFilteringOn = view === "active";
  const stageFilter = stageFilteringOn
    ? parseStageFilter(searchParams?.get(STAGE_PARAM))
    : null;
  // Kept for links shared BEFORE the table owned its own sorting — a
  // bookmarked ?sort=stage&dir=asc still opens in that order. Nothing in the UI
  // writes these any more; every column header is a menu on the table itself.
  const stageSort = stageFilteringOn
    ? parseStageSort(searchParams?.get(SORT_PARAM), searchParams?.get(DIR_PARAM))
    : null;

  // ⚠️ NO SCOPE FILTER ANY MORE, AND THE DEFAULT CHANGED WITH IT.
  //
  // This page used to open on "My engagements" for anyone in a firm with a
  // team, and the picker was the only way back to the whole list. With the
  // picker gone that default would have been a filter nobody could see and
  // nobody could clear — an owner would open the page and quietly be shown a
  // fraction of their firm's work. So the list now starts as ALL of it, and
  // narrowing to one person is the Assignee column's menu.
  //
  // (The old picker's own history is worth keeping: it once offered every
  // teammate as an option, reachable by ?assignee=<id>. That was a filter doing
  // navigation's job — the page still said "Active engagements" and named
  // nobody — and a teammate's work is a question about the teammate, answered
  // on their profile.)

  const q = query.trim().toLowerCase();

  // Search — the one thing above the table that a column menu cannot do, since
  // it looks at the engagement name and the client name together.
  const searched = useMemo(
    () =>
      q !== ""
        ? rows.filter(
            (r) =>
              r.title.toLowerCase().includes(q) ||
              r.clientName.toLowerCase().includes(q),
          )
        : rows,
    [rows, q],
  );

  const visible = useMemo(() => {
    // A ?stage= link from before the column menus still opens filtered, so an
    // old bookmark is not silently ignored. Nothing writes the param now.
    const filtered = filterRowsByStage(searched, stageFilter);
    // Newest first, which is where every column menu starts from. Sorting is
    // the table's own now.
    return stageSort
      ? sortRowsByStage(filtered, stageSort)
      : [...filtered].sort((a, b) => b.recencyAt.localeCompare(a.recencyAt));
  }, [searched, stageFilter, stageSort]);

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

      {/* ⚠️ THE TWO PICKERS THAT USED TO SIT HERE ARE GONE — the founder, of the
          row above the table: "get rid of these top things for sorting."

          They were a "My engagements / All firm" select and an "All stages"
          select, and both now exist as the Assignee and Status column menus:
          same two questions, asked on the column that answers them, instead of
          a bar of controls sitting above a table that could not sort itself.
          Leaving both would have been two ways to filter one list, disagreeing
          the moment somebody used them together.

          Search stays. It is not a filter on one column — it looks across the
          engagement name and the client name at once, which no column menu
          does. */}
      {/* The count moved INTO the table (countLabel below). It has to be
          counted after the column menus have filtered, and only the table knows
          that — out here it sat at 10 while the table showed 3. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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
        emptyText={
          q !== ""
            ? tDash("wl_empty_search")
            : // A stage filter hiding everything is a DIFFERENT empty than "you
              // have no active engagements" — say which, or the accountant is
              // left wondering where their work went.
              stageFilter
              ? tStage("empty_for_stage")
              : t(`view_${view}_empty`)
        }
        canDelete={canDelete}
        countLabel={(count) => t("count_engagements", { count })}
        growNameColumn
        teamEnabled={teamEnabled}
        // Feeds "Assign to…" in each row's "..." menu. Menu only — no ⇄ column.
        assignMembers={assignMembers}
        viewerId={currentUserId}
        firmId={firmId}
        presenceRoster={assignMembers}
        // Tick-rows-and-reassign, only here. The Overview, the Inbox and the
        // teammate profile pass nothing and get no checkbox column at all —
        // this is the list you actually triage from.
        bulkAssignMembers={teamEnabled ? assignMembers : undefined}
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

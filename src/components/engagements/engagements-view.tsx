"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
// useSearchParams is locale-agnostic, so it comes from next/navigation — but the
// ROUTER must be the i18n one. usePathname (i18n) returns a locale-STRIPPED path
// ("/engagements"), and feeding that to next/navigation's router navigates to the
// literal path, which under localePrefix:"as-needed" IS the default locale — so a
// French accountant clicking a filter chip gets thrown back into English. The
// i18n router re-applies the current locale prefix.
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  WorklistTable,
  type WorklistRow,
} from "@/components/dashboard/engagements-worklist";
import { daysUntilPurge } from "@/lib/engagements/lifecycle";
import {
  TAB_VIEWS,
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
import { ViewTabs } from "@/components/ui/view-tabs";
import { EngagementsBoard } from "@/components/engagements/engagements-board";
import { Columns3, List } from "lucide-react";
import { cn } from "@/lib/cn";
import { localDay } from "@/lib/time/dates";
import type { AppLocale } from "@/lib/format";

// The user's list-vs-board choice, remembered per browser (spec: persist per
// user). localStorage rather than a users column: the choice is a viewing
// habit, not firm data, and it must not cost a write per toggle.
const VIEW_MODE_KEY = "engagements_view_mode";

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
  savedViews = [],
  viewLinks = [],
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
  /** This person's saved filter sets for this list (1630). */
  savedViews?: { id: string; name: string; filters: Record<string, unknown> }[];
  /** Ready to review / Archived / Recently deleted — the overflow views that
   *  used to live in the page header's kebab. */
  viewLinks?: { href: string; label: string; count?: number }[];
}) {
  const t = useTranslations("Engagements");
  const tDash = useTranslations("Dashboard");
  const tStage = useTranslations("Stage");
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  // List | Board (timer v2 Part B). Starts as "list" on both server and
  // client, then a post-hydration frame restores the saved choice — the
  // banner/pill pattern, because a localStorage read in the initializer
  // would make the server render disagree with the browser.
  const [viewMode, setViewMode] = useState<"list" | "board">("list");
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        if (window.localStorage.getItem(VIEW_MODE_KEY) === "board") {
          setViewMode("board");
        }
      } catch {
        // Storage unavailable — stay on list.
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  const pickMode = (mode: "list" | "board") => {
    setViewMode(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Storage unavailable — the choice just doesn't persist.
    }
  };

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
  // tab bar. Which one is current comes from the `view` prop — each sub-page is
  // its own route and already knows which it is, so matching the pathname a
  // second time was one more thing to keep in step.
  const hrefFor = (v: EngagementView) =>
    v === "active" ? "/engagements" : `/engagements/${v}`;

  return (
    <div className="space-y-5">
      {/* ⚠️ THE PILLS ARE GONE, THE VIEWS ARE NOT. The founder: "remove the top
          header sorter buttons... it doesnt align with canopys design and
          neither the task view page."

          What did not align was the TREATMENT — a filled pill around the active
          view and coloured badge chips around the counts, which made a row of
          tabs read as a strip of buttons. Both references they named have this
          exact row; Canopy's is "Active | All Engagements | Awaiting Acceptance
          | Drafts". Deleting the views would also have stranded Drafts,
          Completed, Archived and Recently deleted — four routes with no other
          way in now the rail flyout is two buttons (#1260).

          Search rides the same row rather than sitting on its own. Since the
          two filter pickers came out, it was alone on a line with an empty half
          beside it — a band of nothing between the tabs and the table. */}
      <div className="flex flex-col gap-3 border-b border-border sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <ViewTabs
          className="flex-1 border-b-0"
          ariaLabel={t("views_label")}
          activeKey={view}
          tabs={TAB_VIEWS.map((v) => ({
            key: v,
            label: t(viewLabelKey(v)),
            href: hrefFor(v),
            count: badgeFor(v),
            // Recently deleted counts DOWN to a purge, so its number is a
            // warning rather than a total. It keeps the destructive colour on
            // the digits alone — the chip around them is what came out.
            tone: v === "deleted" ? ("destructive" as const) : undefined,
          }))}
        />
        <div className="flex items-center gap-1 pb-2">
          {/* List | Board — two quiet icon buttons, the choice persisted. */}
          <button
            type="button"
            onClick={() => pickMode("list")}
            aria-pressed={viewMode === "list"}
            aria-label={t("board_view_list")}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              viewMode === "list"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <List className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => pickMode("board")}
            aria-pressed={viewMode === "board"}
            aria-label={t("board_view_board")}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              viewMode === "board"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Columns3 className="size-4" aria-hidden />
          </button>
        </div>
        <div className="relative pb-2 sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-[calc(50%-0.25rem)] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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

          The search that stayed moved UP onto the tab row — alone down here it
          left a band of empty page between the tabs and the table. The count
          moved INTO the table (countLabel below), because it has to be counted
          after the column menus have filtered and only the table knows that. */}

      {viewMode === "board" ? (
        // The BOARD (timer v2 Part B): same rows, same filters, same search —
        // a different projection, never a different dataset. Columns per
        // member; drag = the row menu's reassign. Overdue is judged against
        // the BROWSER's day here (the accountant's own desk), a deliberate
        // hair's difference from the table's server-fed day.
        <EngagementsBoard
          rows={visible}
          members={assignMembers ?? []}
          locale={locale}
          canReassign={teamEnabled}
          today={localDay()}
        />
      ) : (
      <WorklistTable
        savedViews={savedViews}
        viewLinks={viewLinks}
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
        // The tab row above already ends in a rule; the table drawing its own
        // put two hairlines eight pixels apart.
        flushTop
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
      )}
    </div>
  );
}

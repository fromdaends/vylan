"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  WorklistTable,
  type WorklistRow,
} from "@/components/dashboard/engagements-worklist";
import { StageFilterSelect } from "@/components/engagements/stage-filter-select";
import {
  countByStage,
  filterRowsByStage,
} from "@/lib/engagements/stage-filter";
import type { AppLocale } from "@/lib/format";
import type { EngagementStage } from "@/lib/engagements/stage";

// A worklist you can search and filter by stage — the toolbar half of the
// /engagements screen, over a row set the SERVER has already narrowed.
//
// ONE component for every "here is somebody's / something's work" list: the
// client page's Engagements tab and the teammate profile's. The founder's note
// on the first attempt was that a tab holding the overview's five-row block is
// not a page ("you just moved the little block to a new tab… it should be the
// entire thing"), and the answer to that on a second page is this same
// component again, not a second copy of it — the repo's Cohesion rule.
//
// DELIBERATELY NOT A FORK of EngagementsView. That one owns the /engagements
// route: it writes ?scope= and ?stage= into the URL and renders that page's
// view pills and mine/everyone picker, none of which mean anything inside one
// client or one person. This holds its filter state locally instead, which is
// also what keeps typing in the search box from costing a server round-trip.
//
// The LIFECYCLE filter (Active / Ready / Completed / Archived) is NOT in here:
// it changes which rows the server loads, so it stays a link in the owning
// page's toolbar and the result arrives as `rows`.
export function WorklistBrowser({
  rows,
  locale,
  emptyText,
  emptySearchText,
  emptyStageText,
  searchClientNames = false,
  teamEnabled = true,
  assignMembers,
  reassignMembers,
  viewerId,
  firmId,
  presenceRoster,
  canDelete = false,
}: {
  rows: WorklistRow[];
  locale: AppLocale;
  /** Nothing here at all. */
  emptyText: string;
  /** Nothing matched what you typed. */
  emptySearchText: string;
  /** Nothing at the stage you picked. */
  emptyStageText: string;
  // Whether the search box also matches the CLIENT column. On a client's own
  // page it must not: the name is identical on every row, so one stray letter
  // would return the whole table. On a person's page it is the most useful
  // thing to search by ("what am I doing for Smith Holdings").
  searchClientNames?: boolean;
  teamEnabled?: boolean;
  // Row-menu assignment targets, passed straight through to the table. The
  // difference between these two is real (assign vs hand over to someone else),
  // so both stay — see WorklistTable's own notes.
  assignMembers?: { id: string; name: string }[];
  reassignMembers?: { id: string; name: string }[];
  viewerId?: string | null;
  firmId?: string | null;
  presenceRoster?: readonly { id: string; name: string }[];
  canDelete?: boolean;
}) {
  const tDash = useTranslations("Dashboard");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<EngagementStage | null>(null);

  const q = query.trim().toLowerCase();

  // Counts come from the UNFILTERED rows, so each stage's number keeps meaning
  // "how many are here" rather than "how many survived the filter I already
  // applied" — picking one stage must not zero all the others.
  const stageCounts = useMemo(() => countByStage(rows), [rows]);

  const visible = useMemo(() => {
    let out = filterRowsByStage(rows, stageFilter);
    if (q) {
      out = out.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.assigneeName ?? "").toLowerCase().includes(q) ||
          (searchClientNames && r.clientName.toLowerCase().includes(q)),
      );
    }
    // sortRowsByStage takes a real direction, not a nullable one: no direction
    // means the caller's own order (newest first), which `rows` already is.
    // Sorting is the TABLE's now — every column header is a menu, so this
    // list no longer decides an order beyond its own filtering.
    return out;
  }, [rows, stageFilter, q, searchClientNames]);

  // Stage is a property of LIVE work. On a completed or archived list every row
  // has no stage, so the filter would offer six options that all read 0 and a
  // sort that cannot reorder anything.
  const stageFilteringOn = rows.some((r) => r.stage);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        {stageFilteringOn ? (
          <StageFilterSelect
            counts={stageCounts}
            selected={stageFilter}
            onSelect={setStageFilter}
          />
        ) : (
          // Holds the search box on the right even with no filter beside it, so
          // the toolbar does not jump sides between lifecycle tabs.
          <span />
        )}
        <div className="relative sm:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
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
        // Three different empties: "no results" and "nothing here" send the
        // reader looking in different places, and being told to create work
        // when a search simply missed is worse than saying nothing.
        emptyText={
          q !== "" ? emptySearchText : stageFilter ? emptyStageText : emptyText
        }
        canDelete={canDelete}
        growNameColumn
        teamEnabled={teamEnabled}
        assignMembers={assignMembers}
        reassignMembers={reassignMembers}
        viewerId={viewerId}
        firmId={firmId}
        presenceRoster={presenceRoster}
        // No bulk checkbox column. The firm-wide list is where you triage in
        // bulk; on one client or one person it would be a column of ticks for
        // four rows.
      />
    </div>
  );
}

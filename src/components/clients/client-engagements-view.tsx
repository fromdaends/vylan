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
  sortRowsByStage,
  nextStageSort,
  type StageSortDir,
} from "@/lib/engagements/stage-filter";
import type { AppLocale } from "@/lib/format";
import type { EngagementStage } from "@/lib/engagements/stage";

// One client's engagements, as a real list rather than a preview.
//
// The founder's words when the tab was the overview's five-row panel moved
// across: "you just moved the little block to a new tab… it should be the
// entire thing." So this is the Engagements screen, scoped to one client: the
// same WorklistTable every other list uses (status pill, progress, assignee,
// due date, hover row menu, presence), the same stage filter, the same search.
//
// DELIBERATELY NOT A FORK of EngagementsView. That component owns the
// /engagements route — it writes ?scope= and ?stage= into the URL, renders the
// page's own view pills and a scope picker for "mine vs everyone", none of
// which mean anything inside one client. Copying it would have produced a
// second table that drifts. This holds its filter state locally instead, which
// is also what keeps a tab switch from costing a server round-trip.
//
// The LIFECYCLE filter (Active / Ready / Completed / Archived) is NOT here: it
// changes which rows the server loads, so it stays a link in the page's own
// toolbar and arrives as `rows`.
export function ClientEngagementsView({
  rows,
  locale,
  emptyText,
  emptySearchText,
  emptyStageText,
  teamEnabled,
  assignMembers,
  viewerId,
  firmId,
  canDelete,
}: {
  rows: WorklistRow[];
  locale: AppLocale;
  emptyText: string;
  emptySearchText: string;
  emptyStageText: string;
  teamEnabled: boolean;
  assignMembers: { id: string; name: string }[];
  viewerId: string | null;
  firmId: string | null;
  canDelete: boolean;
}) {
  const tDash = useTranslations("Dashboard");
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<EngagementStage | null>(null);
  const [stageSort, setStageSort] = useState<StageSortDir | null>(null);

  const q = query.trim().toLowerCase();

  // Stage counts come from the UNFILTERED rows, so the numbers beside each
  // stage keep meaning "how many are here" rather than "how many survived the
  // filter I already applied".
  const stageCounts = useMemo(() => countByStage(rows), [rows]);

  const visible = useMemo(() => {
    let out = filterRowsByStage(rows, stageFilter);
    if (q) {
      // Title and assignee only. The client's name is the same on every row
      // here, so matching it would return the whole table for a stray letter.
      out = out.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          (r.assigneeName ?? "").toLowerCase().includes(q),
      );
    }
    // sortRowsByStage takes a direction, not a nullable one: no direction means
    // the caller's own order (newest first), which is what `rows` already is.
    return stageSort ? sortRowsByStage(out, stageSort) : out;
  }, [rows, stageFilter, stageSort, q]);

  // Stage is a property of LIVE work: a completed or archived list filtered by
  // workflow stage is noise, so the control only appears when a row has one.
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
        // Three different empties, because "no results" and "nothing here" send
        // the reader looking in different places.
        emptyText={
          q !== "" ? emptySearchText : stageFilter ? emptyStageText : emptyText
        }
        canDelete={canDelete}
        growNameColumn
        teamEnabled={teamEnabled}
        assignMembers={assignMembers}
        viewerId={viewerId}
        firmId={firmId}
        presenceRoster={assignMembers}
        // No bulk checkbox column: the firm-wide list is where you triage in
        // bulk. On one client it would be a column of ticks for four rows.
        statusSort={stageFilteringOn ? stageSort : null}
        onStatusSortToggle={
          stageFilteringOn ? () => setStageSort(nextStageSort) : undefined
        }
      />
    </div>
  );
}

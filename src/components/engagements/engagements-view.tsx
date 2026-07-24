"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Search, Users } from "lucide-react";
// useSearchParams is locale-agnostic, so it comes from next/navigation — but the
// ROUTER must be the i18n one. usePathname (i18n) returns a locale-STRIPPED path
// ("/engagements"), and feeding that to next/navigation's router navigates to the
// literal path, which under localePrefix:"as-needed" IS the default locale — so a
// French accountant clicking a filter chip gets thrown back into English. The
// i18n router re-applies the current locale prefix.
import { useSearchParams } from "next/navigation";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
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
import type { EngagementStage } from "@/lib/engagements/stage";
import {
  DIR_PARAM,
  SORT_PARAM,
  SORT_STAGE,
  STAGE_PARAM,
  countByStage,
  filterRowsByStage,
  nextStageSort,
  parseStageFilter,
  parseStageSort,
  sortRowsByStage,
} from "@/lib/engagements/stage-filter";
import { StageFilterSelect } from "./stage-filter-select";
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
  members,
}: {
  view: EngagementView;
  rows: WorklistRow[];
  locale: AppLocale;
  canDelete: boolean;
  currentUserId: string | null;
  badges: { ready: number; deleted: number };
  teamEnabled: boolean;
  // Active firm members, for the "view a teammate's work" scope options. Empty
  // for a solo firm (the scope picker is hidden then anyway).
  members: { id: string; name: string }[];
}) {
  const t = useTranslations("Engagements");
  const tDash = useTranslations("Dashboard");
  const tStage = useTranslations("Stage");
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startUrlTransition] = useTransition();
  const [query, setQuery] = useState("");

  // Stage filter + stage sort live in the URL, not in component state, so a
  // filtered view can be bookmarked and shared, and so it survives opening an
  // engagement and coming back (the browser restores the query string). Only
  // the Active view offers them — an engagement's stage is a property of live
  // work, so filtering the Drafts or Cancelled lists by it would be noise.
  const stageFilteringOn = view === "active";
  const stageFilter = stageFilteringOn
    ? parseStageFilter(searchParams?.get(STAGE_PARAM))
    : null;
  const stageSort = stageFilteringOn
    ? parseStageSort(searchParams?.get(SORT_PARAM), searchParams?.get(DIR_PARAM))
    : null;

  // Write the query string. Mirrors the app's existing URL-filter pattern
  // (clients-toolbar): replace, not push, so the Back button leaves the page
  // rather than stepping back through every filter the accountant tried — and so
  // the URL captured when they open an engagement is the filtered one.
  function setParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    startUrlTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const selectStage = (stage: EngagementStage | null) =>
    setParams({ [STAGE_PARAM]: stage });

  const toggleStageSort = () => {
    const next = nextStageSort(stageSort);
    setParams({
      [SORT_PARAM]: next ? SORT_STAGE : null,
      // Drop the direction with the sort key — a lone ?dir= means nothing and
      // parseStageSort ignores it anyway, so leaving it would be litter in a
      // URL people are meant to share.
      [DIR_PARAM]: next,
    });
  };
  // Scope filter — All / Mine / a specific teammate ("view Marie's work").
  // "Mine" and "All" are the personal default, remembered per user in
  // localStorage. A specific teammate is a TRANSIENT lens: it lives in the URL
  // (?assignee=<id>) so it's shareable and survives opening an engagement and
  // coming back (mirroring the stage filter) — but it never becomes the sticky
  // default. selectAssignedTo already accepts any user id, so the filter itself
  // generalizes for free.
  const ASSIGNEE_PARAM = "assignee";
  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  // Teammates other than the viewer (the viewer is covered by "Mine").
  const otherMembers = useMemo(
    () => members.filter((m) => m.id !== currentUserId),
    [members, currentUserId],
  );

  // Resolve a valid scope from ?assignee=, or null if absent/unknown. "all" and
  // the current user map to the named values; any other known member id is that
  // teammate's lens. A stale id (member left) is ignored so the view never
  // filters to nobody.
  const urlAssignee = searchParams?.get(ASSIGNEE_PARAM) ?? null;
  const scopeFromUrl: string | null =
    urlAssignee == null
      ? null
      : urlAssignee === "all"
        ? "all"
        : urlAssignee === currentUserId
          ? "mine"
          : memberIds.has(urlAssignee)
            ? urlAssignee
            : null;

  // Default to YOUR OWN work in team mode — you see just your engagements until
  // you switch to All firm or a teammate's lens (founder's call: personal-first,
  // even if that means an empty list you can widen with one click). A ?assignee=
  // deep-link or a remembered Mine/All choice still wins (below). Non-team firms
  // stay on "all" (there's only you, and the Mine/All filter isn't shown).
  const [scope, setScope] = useState<string>(
    scopeFromUrl ?? (teamEnabled ? "mine" : "all"),
  );
  // Keep the scope in sync with a ?assignee= deep-link (e.g. "view Marie's work"
  // from the team page). No localStorage: engagements default to "mine" on every
  // load — same as the Clients list — and switching to All firm / a teammate is a
  // per-visit choice that doesn't stick, so you always land on your own work.
  useEffect(() => {
    if (!currentUserId || !teamEnabled || !scopeFromUrl) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScope(scopeFromUrl);
  }, [currentUserId, teamEnabled, scopeFromUrl]);
  const chooseScope = (s: string) => {
    setScope(s);
    // Reflect a teammate lens in the URL; clear it for Mine/All so the URL stays
    // clean and a reload returns to the "mine" default.
    setParams({ [ASSIGNEE_PARAM]: s === "mine" || s === "all" ? null : s });
  };

  const q = query.trim().toLowerCase();

  // Everything EXCEPT the stage filter: search + the my/all scope. This is what
  // the per-stage counts are computed from, so each count is exactly what
  // choosing that stage would reveal — and picking one doesn't zero the others.
  const beforeStageFilter = useMemo(() => {
    let base =
      q !== ""
        ? rows.filter(
            (r) =>
              r.title.toLowerCase().includes(q) ||
              r.clientName.toLowerCase().includes(q),
          )
        : rows;
    // Resolve the scope to an assignee id: "all" -> no filter, "mine" -> me, any
    // other value -> that teammate. selectAssignedTo handles any id.
    const scopedUserId =
      scope === "all" ? null : scope === "mine" ? currentUserId : scope;
    if (teamEnabled && scopedUserId) {
      base = selectAssignedTo(base, scopedUserId);
    }
    return base;
  }, [rows, q, scope, currentUserId, teamEnabled]);

  const stageCounts = useMemo(
    () => countByStage(beforeStageFilter),
    [beforeStageFilter],
  );

  const visible = useMemo(() => {
    const filtered = filterRowsByStage(beforeStageFilter, stageFilter);
    // Stage sort when asked for, otherwise the table's long-standing default:
    // newest first. sortRowsByStage breaks its own ties by recency too, so the
    // two orders agree inside a stage instead of scrambling.
    return stageSort
      ? sortRowsByStage(filtered, stageSort)
      : [...filtered].sort((a, b) => b.recencyAt.localeCompare(a.recencyAt));
  }, [beforeStageFilter, stageFilter, stageSort]);

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
        {/* The pickers travel together, so the toolbar stays one line instead of
            spending a whole row on filters. */}
        <div className="flex flex-wrap items-center gap-2">
          {teamEnabled && (
            <Select value={scope} onValueChange={chooseScope}>
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
                {otherMembers.length > 0 && <SelectSeparator />}
                {otherMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Stage filter — Active only. An engagement's stage is a property of
              live work, so filtering Drafts or Cancelled by it would be noise. */}
          {stageFilteringOn && (
            <StageFilterSelect
              counts={stageCounts}
              selected={stageFilter}
              onSelect={selectStage}
            />
          )}
        </div>
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
        growNameColumn
        teamEnabled={teamEnabled}
        // Opt in to the sortable Status header. Only this view passes these, so
        // every other table (the Overview included) keeps its plain header.
        statusSort={stageFilteringOn ? stageSort : null}
        onStatusSortToggle={stageFilteringOn ? toggleStageSort : undefined}
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

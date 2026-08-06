"use client";

// The controls above the engagements list, as chips.
//
// ── WHAT THIS REPLACED, AND WHY IT IS NOT TWO CHROMES ──────────────────────
//
// Six tabs — Active, All, Awaiting acceptance, Drafts, Completed, Archived,
// Recently deleted — stretched across the top of the page, five of which most
// people never click. The handoff replaces them with filter chips on the board.
//
// Taking that literally would have left the list view on tabs and the board on
// chips: one screen, two vocabularies, and the next change to either made
// twice. The founder's ruling when asked was "as long as it's simpler and
// easier to use — even come up with your way", so this is ONE row used by BOTH
// views.
//
// The six views collapse into a single chip that says where you are and opens
// the rest. Nothing is stranded: Drafts, Completed, Archived and Recently
// deleted are one click away instead of permanently occupying the widest strip
// on the page — which matters, because the rail flyout stopped being a way into
// them (#1260).
//
// ── A CHIP THAT CAN BE DISMISSED IS A FILTER; ONE THAT CANNOT IS A PLACE ───
//
// The view chip has no ✕ — you are always looking at SOME view, and dismissing
// it would beg the question of what you would be left with. The search chip
// does, because clearing a search returns you to the thing you were filtering.

import { Search, X, ChevronDown, List, Columns3 } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

export type ViewChoice = {
  key: string;
  label: string;
  href: string;
  /** Null and undefined both mean "no badge" — the callers disagree about
   *  which they use and neither should have to convert. */
  count?: number | null;
  /** Recently deleted counts DOWN to a purge — its number is a warning. */
  tone?: "destructive";
};

export function EngagementFilterChips({
  views,
  activeKey,
  query,
  onQueryChange,
  viewMode,
  onViewModeChange,
  labels,
}: {
  views: ViewChoice[];
  activeKey: string;
  query: string;
  onQueryChange: (next: string) => void;
  viewMode: "list" | "board";
  onViewModeChange: (next: "list" | "board") => void;
  labels: {
    viewsLabel: string;
    searchPlaceholder: string;
    searchChip: string;
    clearSearch: string;
    listView: string;
    boardView: string;
  };
}) {
  const active = views.find((v) => v.key === activeKey) ?? views[0];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* ── WHERE YOU ARE ───────────────────────────────────────────────
          A chip, not a tab strip. It states the current view and opens the
          others; the count rides inside it so the number you care about is the
          one you are looking at. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={labels.viewsLabel}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-border bg-card pl-3 pr-2 text-[12.5px] font-medium transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-muted-foreground">{labels.viewsLabel}:</span>
            <span>{active?.label}</span>
            {active?.count != null && active.count > 0 && (
              <span
                className={cn(
                  "tabular-nums",
                  active.tone === "destructive"
                    ? "text-destructive"
                    : "text-muted-foreground",
                )}
              >
                {active.count}
              </span>
            )}
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {views.map((v) => (
            <DropdownMenuItem key={v.key} asChild>
              <Link href={v.href} className="flex items-center justify-between">
                <span className={cn(v.key === activeKey && "font-semibold")}>
                  {v.label}
                </span>
                {v.count != null && v.count > 0 && (
                  <span
                    className={cn(
                      "tabular-nums text-xs",
                      v.tone === "destructive"
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {v.count}
                  </span>
                )}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The search, once typed, becomes a chip too — so what is narrowing the
          list is stated in one place rather than only implied by a box that
          happens to have text in it. */}
      {query.trim() !== "" && (
        <span className="inline-flex h-[30px] items-center gap-1 rounded-full border border-border bg-card pl-3 pr-1 text-[12.5px] font-medium">
          <span className="text-muted-foreground">{labels.searchChip}:</span>
          <span className="max-w-[14ch] truncate">{query}</span>
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label={labels.clearSearch}
            className="grid size-[18px] place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <X className="size-[11px]" aria-hidden />
          </button>
        </span>
      )}

      <div className="flex-1" />

      <div className="relative w-full sm:w-60">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          className="h-[34px] pl-8 text-[13px]"
        />
      </div>

      {/* List | Board, as one bordered pair rather than two loose icons. */}
      <div className="flex shrink-0 overflow-hidden rounded-lg border border-border">
        <ModeButton
          on={viewMode === "list"}
          onClick={() => onViewModeChange("list")}
          label={labels.listView}
        >
          <List className="size-4" aria-hidden />
        </ModeButton>
        <ModeButton
          on={viewMode === "board"}
          onClick={() => onViewModeChange("board")}
          label={labels.boardView}
        >
          <Columns3 className="size-4" aria-hidden />
        </ModeButton>
      </div>
    </div>
  );
}

function ModeButton({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 place-items-center transition-colors",
        on
          ? "bg-accent-subtle text-accent"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

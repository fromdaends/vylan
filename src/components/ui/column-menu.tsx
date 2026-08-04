"use client";

// A column header that is a MENU: its two sort directions, then its values.
//
// Extracted from the tasks table so the ENGAGEMENTS table is the same object
// rather than a lookalike — the founder, on the engagements list: "it needs to
// be, like, up to date. So how the tasks looks needs to be similar to how the
// engagements look and function in a similar process."
//
// A copy of this would look identical the day it was written and then drift,
// which is the failure this codebase has now hit three times (the Overview's
// task card, the engagement's task list, the add-task flow). One component.
//
// The VALUES are the point. "Sort by client" floats one client's rows to the
// top of a hundred; "show me only this client" answers the question. An arrow
// could never do the second, which is what made the first version feel — the
// founder's word — redundant.
//
// Omitting `options` gives a sort-only menu, which is right for a date: there
// is nothing to tick in a column of a hundred distinct days.

import { ArrowDown, ArrowUp, ChevronDown, Plus } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SortState = { key: string; desc: boolean };

/**
 * A column header that is a MENU: its two sort directions, then its values.
 *
 * The values are the point. "Sort by client" floats one client's rows to the
 * top of a hundred; "show me only this client" answers the question. An arrow
 * could never do the second, which is what made the first version feel — the
 * founder's word — redundant.
 *
 * Omitting `options` gives a sort-only menu, which is right for a date: there
 * is nothing to tick in a column of a hundred distinct days.
 */
export function ColumnMenu({
  label,
  t,
  className,
  sortKey,
  sort,
  setSort,
  sortLabels,
  options,
  selected = [],
  onChange,
  footerHref,
  footerLabel,
}: {
  label: string;
  /** Only used for the menu's accessible name and its "show all" row. */
  t: (key: string, values?: Record<string, string>) => string;
  className?: string;
  sortKey: string;
  sort: SortState;
  setSort: (next: SortState) => void;
  /** [ascending, descending] — worded for the column. "Earliest first" beats
   *  "A → Z" on a date, and "Lowest first" beats it on a priority. */
  sortLabels: [string, string];
  options?: { value: string; label: string }[];
  selected?: string[];
  onChange?: (next: string[]) => void;
  /** A quiet way out of the menu to where these values are managed. */
  footerHref?: string;
  footerLabel?: string;
}) {
  const active = sort.key === sortKey;
  const filtering = selected.length > 0;

  return (
    <th className={cn("px-2 py-2.5 font-medium", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("column_menu", { label })}
            // Canopy's header treatment, which the founder asked for by name:
            // sentence case at reading size in the normal text colour, with a
            // caret. The uppercase micro-label this replaced read as a table
            // caption — something you skim past — when it is in fact the
            // control that sorts and filters the column.
            className={cn(
              "flex w-full items-center gap-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active || filtering
                ? "text-foreground"
                : "text-foreground/80 hover:text-foreground",
            )}
          >
            {label}
            {filtering && (
              <span className="rounded-full bg-foreground px-1 text-[10px] tabular-nums text-background">
                {selected.length}
              </span>
            )}
            {active ? (
              sort.desc ? (
                <ArrowDown className="size-3 shrink-0" aria-hidden />
              ) : (
                <ArrowUp className="size-3 shrink-0" aria-hidden />
              )
            ) : (
              // A caret, like Canopy's: it says "there is a menu here"
              // without claiming a sort is applied when none is.
              <ChevronDown className="size-3.5 shrink-0 opacity-50" aria-hidden />
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            className="gap-2 text-xs"
            onSelect={() => setSort({ key: sortKey, desc: false })}
          >
            <ArrowUp className="size-3.5" aria-hidden />
            {sortLabels[0]}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 text-xs"
            onSelect={() => setSort({ key: sortKey, desc: true })}
          >
            <ArrowDown className="size-3.5" aria-hidden />
            {sortLabels[1]}
          </DropdownMenuItem>

          {options && options.length > 0 && onChange && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[11px] font-normal uppercase tracking-wide text-muted-foreground">
                {label}
              </DropdownMenuLabel>
              <div className="max-h-64 overflow-y-auto">
                {options.map((o) => (
                  <DropdownMenuCheckboxItem
                    key={o.value}
                    checked={selected.includes(o.value)}
                    // Stays open: narrowing to three clients should not cost
                    // three trips to the same header.
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(on) =>
                      onChange(
                        on
                          ? [...selected, o.value]
                          : selected.filter((x) => x !== o.value),
                      )
                    }
                  >
                    <span className="truncate">{o.label}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </div>
              {filtering && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs"
                    onSelect={() => onChange([])}
                  >
                    {t("filter_all")}
                  </DropdownMenuItem>
                </>
              )}
              {footerHref && footerLabel && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link
                      href={footerHref}
                      className="cursor-pointer gap-2 text-xs text-muted-foreground"
                    >
                      <Plus className="size-3" aria-hidden />
                      {footerLabel}
                    </Link>
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </th>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { ArrowUpDown, Check, X } from "lucide-react";
import { SORT_OPTIONS, type SortKey } from "./sort";

// ONE control — "Sort & filter" — instead of a tab strip, two selects and two
// checkboxes strung across the top of the list.
//
// They are all still here, one click away, grouped into check-marked sections.
// What is ACTIVE is stated in plain words to the right of the button, and the
// button carries a count: a filter you cannot see is indistinguishable from
// "my clients disappeared", which is the failure this shape has to avoid.
//
// Every item navigates rather than setting state, so a filtered list stays a
// real URL — linkable, refreshable, back-buttonable. Search is the exception
// and always was: it is an in-memory filter on an already-loaded list, held by
// the parent view, and it lives in the page header.

const TYPES = ["all", "individual", "business"] as const;

export function ClientsToolbar({
  type,
  includeArchived,
  sort,
  activeOnly,
  ownerFilter,
  ownerDefault,
  teamEnabled,
}: {
  type: "all" | "individual" | "business";
  includeArchived: boolean;
  sort: SortKey;
  activeOnly: boolean;
  /** "all" | "mine" | a specific member id. */
  ownerFilter: string;
  /** What owner filter this page opens on. In team mode /clients opens on YOUR
   * book, so "mine" is the resting state — counting it as an active filter put
   * a permanent badge and a Clear button on a list nobody had filtered, and
   * Clear then had nothing to clear. */
  ownerDefault: string;
  teamEnabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const t = useTranslations("Clients");

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(search?.toString() ?? "");
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  // What counts as "active" is what DIFFERS FROM THE DEFAULT VIEW, not what is
  // simply set. Sort is excluded entirely — it never hides a row, so counting
  // it would explain a short list with something that cannot shorten one.
  const ownerChanged = teamEnabled && ownerFilter !== ownerDefault;
  const activeCount =
    (type !== "all" ? 1 : 0) +
    (ownerChanged ? 1 : 0) +
    (activeOnly ? 1 : 0) +
    (includeArchived ? 1 : 0);

  const summary: string[] = [];
  if (type !== "all") summary.push(t(`filter_${type}`));
  if (ownerChanged) {
    summary.push(ownerFilter === "all" ? t("owner_all") : t("owner_mine"));
  }
  if (activeOnly) summary.push(t("filter_active_only"));
  if (includeArchived) summary.push(t("filter_include_archived"));

  const check = (on: boolean) => (
    <Check
      className={cn("size-3.5 text-accent", on ? "opacity-100" : "opacity-0")}
      aria-hidden
    />
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-9 gap-2 rounded-[9px] px-3.5 text-[13.5px] font-medium"
            >
              <ArrowUpDown
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
              {t("filter_button")}
              {activeCount > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-[5px] text-[11px] font-semibold text-accent-foreground">
                  {activeCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[420px] w-60 overflow-y-auto p-1.5"
          >
            <Section label={t("sort_label")} />
            {SORT_OPTIONS.map((key) => (
              <DropdownMenuItem
                key={key}
                className="gap-2 rounded-[7px] text-[13px]"
                onSelect={() => setParam("sort", key === "recent" ? null : key)}
              >
                {check(sort === key)}
                {t(`sort_${key}`)}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />
            <Section label={t("col_type")} />
            {TYPES.map((v) => (
              <DropdownMenuItem
                key={v}
                className="gap-2 rounded-[7px] text-[13px]"
                onSelect={() => setParam("type", v === "all" ? null : v)}
              >
                {check(type === v)}
                {t(`filter_${v}`)}
              </DropdownMenuItem>
            ))}

            {teamEnabled && (
              <>
                <DropdownMenuSeparator />
                <Section label={t("col_owner")} />
                {/* "My clients" is the default, so it CLEARS the param rather
                    than writing a redundant one; widening to the firm is the
                    thing that gets recorded in the URL. */}
                <DropdownMenuItem
                  className="gap-2 rounded-[7px] text-[13px]"
                  onSelect={() => setParam("owner", null)}
                >
                  {check(ownerFilter === "mine")}
                  {t("owner_mine")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 rounded-[7px] text-[13px]"
                  onSelect={() => setParam("owner", "all")}
                >
                  {check(ownerFilter === "all")}
                  {t("owner_all")}
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />
            <Section label={t("filter_show_label")} />
            {/* Both are TOGGLES — selecting an active one turns it back off,
                which is why they check-mark rather than sitting in a group. */}
            <DropdownMenuItem
              className="gap-2 rounded-[7px] text-[13px]"
              onSelect={() => setParam("active", activeOnly ? null : "1")}
            >
              {check(activeOnly)}
              {t("filter_active_only")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 rounded-[7px] text-[13px]"
              onSelect={() =>
                setParam("archived", includeArchived ? null : "1")
              }
            >
              {check(includeArchived)}
              {t("filter_include_archived")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            className="h-9 gap-1.5 rounded-lg px-2.5 text-[13px] text-muted-foreground"
            onClick={() => startTransition(() => router.replace(pathname))}
            // pathname alone = every param dropped = the default view, which is
            // exactly what "Clear" should mean.
          >
            <X className="size-3.5" />
            {t("filter_clear")}
          </Button>
        )}
      </div>

      {summary.length > 0 && (
        <span className="text-[12.5px] text-muted-foreground">
          {t("filter_active", { list: summary.join(" · ") })}
        </span>
      )}
    </div>
  );
}

function Section({ label }: { label: string }) {
  return (
    <DropdownMenuLabel className="text-[10.5px] font-semibold tracking-[0.07em] uppercase text-muted-foreground">
      {label}
    </DropdownMenuLabel>
  );
}

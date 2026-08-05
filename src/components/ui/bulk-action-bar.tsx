"use client";

// The bar that appears once you tick rows — on tasks, on clients, on
// engagements.
//
// GENERALISED FROM BulkAssignBar (#1082), which did this for engagements and
// only for assignment. The founder, after reading Canopy's bulk docs: "Do bulk
// for tasks and clients and well engagements but expand upon it so its not just
// reassigning."
//
// ── WHY IT STILL FLOATS AT THE BOTTOM AND NOT IN CANOPY'S TOP-RIGHT ────────
//
// Canopy puts its bulk icons in the upper-right of the list. Vylan's bar floats
// over the bottom, and that was a deliberate call worth keeping: it does not
// reflow the list, so ticking a row never moves the row you are ticking, and it
// is mounted ONLY while something is selected — no permanently-parked toolbar
// over an untouched list, which is the founder's standing objection to controls
// that sit there doing nothing. Canopy's icons occupy their header whether or
// not you are using them.
//
// What IS taken from Canopy: the action set (status / priority / dates /
// assignee, with the rarer and destructive ones behind a "More" menu), the
// running "N selected" count, and — most importantly — refusing an action that
// cannot apply to the whole selection rather than half-doing it.
//
// ── IT SPEAKS RowMenuItem ──────────────────────────────────────────────────
//
// The same shape the right-click menus use, so "Change status" means one thing
// in this product and is described one way. A submenu here is a submenu there;
// a destructive item is fenced in both.

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RowMenuItems,
  RowSubItems,
  DROPDOWN_MENU_PARTS,
} from "@/components/engagements/row-menu-items";
import type { RowMenuItem } from "@/components/engagements/engagement-row-menu";
import { cn } from "@/lib/cn";

export function BulkActionBar({
  count,
  actions,
  moreActions = [],
  onClear,
  busy = false,
}: {
  count: number;
  /** Shown as buttons on the bar itself — the handful you reach for daily. */
  actions: RowMenuItem[];
  /** Behind "More". Canopy's shape: the rarer edits and anything destructive. */
  moreActions?: RowMenuItem[];
  onClear: () => void;
  busy?: boolean;
}) {
  const t = useTranslations("Engagements");
  const [pending] = useTransition();
  const disabled = busy || pending;

  if (count === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-2 overflow-x-auto rounded-full border border-border bg-popover/95 py-2 pl-4 pr-2 text-sm shadow-lg backdrop-blur supports-[backdrop-filter]:bg-popover/80">
        <span className="shrink-0 font-medium tabular-nums">
          {t("bulk_selected", { count })}
        </span>

        {actions.map((action) => (
          <BarAction key={action.key} action={action} disabled={disabled} />
        ))}

        {moreActions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                aria-label={t("bulk_more")}
                title={t("bulk_more")}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" side="top" className="w-56">
              <RowMenuItems items={moreActions} parts={DROPDOWN_MENU_PARTS} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          aria-label={t("bulk_clear")}
          title={t("bulk_clear")}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** One action on the bar: a button, or a button that opens its own submenu. */
function BarAction({
  action,
  disabled,
}: {
  action: RowMenuItem;
  disabled: boolean;
}) {
  const Icon = action.icon;
  const cls = cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-opacity disabled:opacity-50",
    action.variant === "destructive"
      ? "bg-destructive text-white"
      : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  );

  if (!action.submenu) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={action.onSelect}
        className={cls}
      >
        <Icon className="size-3.5" aria-hidden />
        {action.label}
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled} className={cls}>
          <Icon className="size-3.5" aria-hidden />
          {action.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" side="top" className="w-56">
        {/* The SAME child list the right-click submenu draws, so picking a
            status looks identical whether you got here from one row or twelve. */}
        <RowSubItems items={action.submenu} Item={DropdownMenuItem} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

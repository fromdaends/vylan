"use client";

// ONE row, for every kind of template.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// The founder: "The UI along the different kinds of templates is inconsistent
// with each other. So, like, what the UI looks like when you click on an
// engagement template and a task template is not the same. So it should be."
//
// They were right, and it was worse than described. FOUR template pages had
// THREE different idioms: engagement templates and client requests drew cards
// in a grid, task templates drew bordered `<li>` rows, and services drew a
// third thing again. Each was written by whoever built that feature, each
// looked fine alone, and together they read as four unrelated screens.
//
// This is the one row. Every template page uses it, so "make templates look
// better" is one edit rather than four, and they cannot drift apart again.
//
// ── THE SHAPE ──────────────────────────────────────────────────────────────
//
// Canopy's template lists are rows, not cards: an icon, the name, a line of
// detail, and an Options (⋮) menu carrying Edit / Duplicate / Delete. Their own
// article describes exactly that — "Click on the Options icon in line with a
// relevant task template. Choose Edit from the pop-out menu." Rows beat cards
// here because a firm ends up with thirty templates and a card grid makes you
// hunt; a list you can scan down does not.

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type TemplateRowAction = {
  label: string;
  onSelect: () => void;
  /** Renders in the destructive colour and sits last. */
  destructive?: boolean;
};

export function TemplateRow({
  icon: Icon,
  name,
  meta,
  badges,
  href,
  actions = [],
  dimmed = false,
}: {
  icon: LucideIcon;
  name: string;
  /** The one line under the name. Already localized and already joined. */
  meta?: string | null;
  /** Small pills beside the name — Draft, Private, Built-in. */
  badges?: ReactNode;
  /**
   * Where the row goes when clicked. Omitted for a template with no screen of
   * its own yet, which then renders as a plain row rather than a dead link.
   */
  href?: string;
  /** The ⋮ menu. No menu is drawn when this is empty. */
  actions?: TemplateRowAction[];
  /** Archived or otherwise inactive — same row, quieter. */
  dimmed?: boolean;
}) {
  const t = useTranslations("Templates");

  const body = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-subtle text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14.5px] font-semibold leading-snug text-foreground">
            {name}
          </span>
          {badges}
        </span>
        {meta && (
          <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">
            {meta}
          </span>
        )}
      </span>
    </>
  );

  return (
    <li
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-border/70 bg-card px-[18px] py-3 transition-all duration-200",
        "hover:border-accent/40 hover:shadow-[0_4px_16px_-6px_rgba(15,23,42,0.18)]",
        dimmed && "opacity-60",
      )}
    >
      {/* The whole row is the link, and the menu is its SIBLING — a button
          cannot legally live inside an anchor, and nesting them is how a menu
          click starts navigating instead of opening. */}
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
          {body}
        </Link>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
      )}

      {actions.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("row_options")}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.label}
                onSelect={action.onSelect}
                className={cn(
                  action.destructive &&
                    "text-destructive focus:text-destructive",
                )}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

/** The list the rows sit in. One place for the gap between them. */
export function TemplateRowList({ children }: { children: ReactNode }) {
  return <ul className="space-y-2">{children}</ul>;
}

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// The shared furniture of a Templates page.
//
// There are FOUR Templates pages now — engagements, tasks, requests, services —
// one per template type, because the founder replaced the single scrolling page
// with the sidebar as the divider: "Get rid of the templates page that exists
// right now to have view all the templates. It should literally be the complete
// divided by the sidebar. And which one you click on then has a completely new
// UI for that type of template."
//
// Four pages is four chances for the header, the grid and the empty state to
// drift apart, which is the exact failure CLAUDE.md's cohesion rule names. So
// they live here once and every page reads them. A page that needs a DIFFERENT
// look gets a prop, not a copy.

export function TemplatesPageHeader({
  title,
  subtitle,
  search,
  action,
}: {
  title: string;
  subtitle: string;
  /** Live filter for this page's list. Sits LEFT of the action, so the one
   * coloured button stays the last thing on the row. */
  search?: ReactNode;
  /** Right-aligned control — usually the "new one" button for this type. */
  action?: ReactNode;
}) {
  return (
    <header className="animate-in-up flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div>
        <h1 className="text-[26px] font-[650] tracking-[-0.02em]">{title}</h1>
        <p className="mt-[5px] max-w-[56ch] text-sm text-muted-foreground">
          {subtitle}
        </p>
      </div>
      {(search || action) && (
        <div className="flex w-full items-center gap-2.5 sm:w-auto">
          {search}
          {action}
        </div>
      )}
    </header>
  );
}

/** The page shell — one width rule for all four, so they line up when you move
 *  between them via the sidebar.
 *
 *  FULL WIDTH: a card grid capped at 1024px leaves two thirds of a monitor
 *  empty and wraps to two columns when four would fit. The page supplies the
 *  handoff's own 28/44/72 padding, so the app shell hands it the bare canvas
 *  (see `fullBleed` in app-shell). */
export function TemplatesPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="w-full space-y-6 px-6 pt-7 pb-18 lg:px-11">{children}</div>
  );
}

export function TemplatesSection({
  title,
  count,
  children,
  action,
}: {
  title: string;
  count: number;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b border-border/60 pb-2">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {title}
          </h2>
          <span className="font-mono text-xs tabular-nums text-muted-foreground/60">
            {count}
          </span>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Cards flow to fit rather than snapping between fixed column counts — the
 *  grid fills a 27" monitor and a laptop with the same rule. */
export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3.5">
      {children}
    </div>
  );
}

/**
 * "You have none of these yet", in ONE shape.
 *
 * It used to take children, and every page built its own arrangement out of
 * them — three listing pages, three slightly different icon tiles, three
 * paragraph widths. The structure is props now, so a page supplies the WORDS
 * and cannot supply a layout.
 *
 * It also stopped drawing its own dashed border. It lives INSIDE the list card
 * now, and a bordered box inside a bordered box reads as a broken frame rather
 * than as an empty list.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  /** One line on what this kind of template is FOR — an empty list is the one
   *  moment somebody is definitely willing to read it. */
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-[550] text-foreground">{title}</p>
      <p className="max-w-[44ch] text-[12.5px] leading-relaxed text-muted-foreground">
        {hint}
      </p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

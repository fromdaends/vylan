import type { ReactNode } from "react";

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
  action,
}: {
  title: string;
  subtitle: string;
  /** Right-aligned control — usually the "new one" button for this type. */
  action?: ReactNode;
}) {
  return (
    <header className="animate-in-up flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
          {subtitle}
        </p>
      </div>
      {action}
    </header>
  );
}

/** The page shell — one width rule for all four, so they line up when you move
 *  between them via the sidebar. */
export function TemplatesPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl space-y-8 min-[1800px]:max-w-[90rem]">
      {children}
    </div>
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

export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 min-[1800px]:grid-cols-4">
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center">
      {children}
    </div>
  );
}

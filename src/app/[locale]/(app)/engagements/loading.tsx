// All-Engagements list skeleton — shown instantly on a cold navigation to any
// Engagements sub-page (this segment's Suspense fallback), so switching tabs
// never sits on a frozen page while the rows load. Mirrors the meshed list:
// title, view-switcher pills, search, and a hairline-divided table. Warm
// revisits (the 30s router cache) skip this entirely and paint instantly.

export default function Loading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 w-56 max-w-full rounded-md bg-muted" />

      <div className="space-y-5">
        {/* View-switcher pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {["w-16", "w-24", "w-20", "w-28", "w-24", "w-24", "w-32"].map(
            (w, i) => (
              <div key={i} className={`h-8 rounded-full bg-muted/50 ${w}`} />
            ),
          )}
        </div>

        {/* Search */}
        <div className="h-9 w-full rounded-md bg-muted/40 sm:w-72" />

        {/* Table: hairline above + row dividers, like the worklist. */}
        <div className="border-t border-border">
          <div className="divide-y divide-border/60">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3.5">
                <div className="h-4 flex-1 rounded bg-muted/50" />
                <div className="hidden h-4 w-32 rounded bg-muted/40 sm:block" />
                <div className="hidden h-4 w-20 rounded bg-muted/40 md:block" />
                <div className="h-4 w-14 rounded bg-muted/40" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

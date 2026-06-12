// Overview skeleton — mirrors the two-column shell so there's no layout shift
// when the real page streams in: main column (header · stats + needs-
// attention · templates · my-engagements) + a sticky right rail (What's new).
// Collapses to one column below lg, matching the page.

export default function Loading() {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10 animate-pulse">
      {/* Main column */}
      <div className="min-w-0 space-y-10 sm:space-y-12">
        {/* Welcome header */}
        <div className="space-y-2">
          <div className="h-9 w-72 max-w-full rounded-md bg-muted" />
          <div className="h-4 w-48 max-w-full rounded-md bg-muted/60" />
        </div>

        {/* Top row: stats strip (left) + Needs attention (right), matching
            the page's 2xl flex layout so nothing shifts when it streams in. */}
        <div className="flex flex-col gap-8 2xl:flex-row 2xl:items-start 2xl:gap-10">
          {/* Stats strip — four hairline-accented counts */}
          <div className="shrink-0 2xl:w-[21rem]">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 2xl:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border-l border-border/40 pl-3">
                  <div className="h-6 w-10 rounded-md bg-muted" />
                  <div className="mt-1.5 h-3 w-20 rounded bg-muted/50" />
                </div>
              ))}
            </div>
          </div>

          {/* Needs attention block (accent-tinted card) */}
          <div className="min-w-0 flex-1 rounded-2xl border border-accent/20 bg-accent/[0.04] p-4 sm:p-5">
            <div className="h-5 w-40 rounded-md bg-muted" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-11 rounded-xl bg-muted/40" />
              ))}
            </div>
          </div>
        </div>

        {/* Templates gallery */}
        <div className="space-y-3">
          <div className="h-5 w-44 rounded-md bg-muted" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted/40" />
            ))}
          </div>
        </div>

        {/* My engagements table */}
        <div className="space-y-3">
          <div className="h-5 w-40 rounded-md bg-muted" />
          <div className="rounded-xl border border-border bg-card">
            <div className="flex gap-2 border-b border-border/60 px-3 py-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-7 w-24 rounded-full bg-muted/40" />
              ))}
            </div>
            <div className="space-y-2 px-5 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 rounded-md bg-muted/30" />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right rail — What's new feed (calm, light) */}
      <aside className="hidden lg:block">
        <div className="space-y-3">
          <div className="h-4 w-28 rounded-md bg-muted" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-2.5 py-1">
              <div className="h-5 w-5 shrink-0 rounded-full bg-muted/50" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-full rounded bg-muted/40" />
                <div className="h-2.5 w-2/3 rounded bg-muted/30" />
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

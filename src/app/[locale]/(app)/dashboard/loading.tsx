// Overview skeleton — mirrors the single-column shell so there's no layout
// shift when the real page streams in: header · stats + needs-attention ·
// templates · my-engagements. (What's new lives behind the header bell now —
// no right rail.)

export default function Loading() {
  return (
    <div className="animate-pulse space-y-10 sm:space-y-12">
      {/* Welcome header */}
      <div className="space-y-2">
        <div className="h-9 w-72 max-w-full rounded-md bg-muted" />
        <div className="h-4 w-48 max-w-full rounded-md bg-muted/60" />
      </div>

      {/* Top region: thin full-width stats strip above a full-width Needs
          attention block, matching the page's stacked layout (and the real
          Needs attention's left accent rule) so nothing shifts when it
          streams in. */}
      <div className="space-y-5 sm:space-y-6">
        {/* Stats strip — four hairline-accented counts across the width */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 sm:gap-x-8 sm:gap-y-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border-l border-border/40 pl-3 sm:pl-4">
              <div className="h-7 w-10 rounded-md bg-muted" />
              <div className="mt-1.5 h-3 w-20 rounded bg-muted/50" />
            </div>
          ))}
        </div>

        {/* Needs attention block — left accent rule, full width */}
        <div className="border-l-2 border-accent/40 pl-4 sm:pl-5">
          <div className="h-5 w-40 rounded-md bg-muted" />
          <div className="mt-3 space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-muted/40" />
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
  );
}

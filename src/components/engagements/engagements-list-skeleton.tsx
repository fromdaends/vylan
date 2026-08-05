// The shape of the All-Engagements list, with nothing in it.
//
// ── TWO USES, ONE SHAPE ────────────────────────────────────────────────────
//
//  1. `loading.tsx` — the Suspense fallback on a cold navigation, ANIMATED so
//     it reads as "loading" rather than as a broken page.
//
//  2. The backdrop behind Create Engagement — STATIC, because it is scenery.
//
// One component so the two cannot drift into different shapes of the same list.
//
// ── WHY THE BACKDROP MUST NOT ANIMATE ──────────────────────────────────────
//
// `backdrop-filter` re-computes every frame the content beneath it CHANGES. An
// animate-pulse under a blur is a full-screen blur recomputed sixty times a
// second, which is exactly the lag the founder reported three times against
// earlier versions of this modal ("its extremly laggy... cant even X out of
// the screen").
//
// So the backdrop passes `animated={false}` and nothing under the blur ever
// moves: no pulse, no scroll (the wrapper is fixed and clipped), no data
// loading in late. The blur paints once.

export function EngagementsListSkeleton({
  /** Pulse while genuinely waiting. Never under a backdrop-filter. */
  animated = true,
}: {
  animated?: boolean;
}) {
  return (
    <div className={animated ? "space-y-8 animate-pulse" : "space-y-8"}>
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

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
  /**
   * How solid the bars are.
   *
   * "muted" — the loading state, on a plain page background.
   *
   * "contrast" — behind the modal's frosted glass. `--muted` is oklch(0.97) in
   * LIGHT mode: nearly white, so under a white scrim and a blur it disappeared
   * entirely and the founder saw a blank page ("no frosted glass"). It looked
   * right in dark mode, where --muted is oklch(0.17), which is exactly why a
   * one-theme check was not enough.
   *
   * A fraction of the FOREGROUND colour instead: near-black on white, near-white
   * on black. Legible in both, by construction rather than by luck.
   */
  tone = "muted",
}: {
  animated?: boolean;
  tone?: "muted" | "contrast";
}) {
  const strong = tone === "contrast" ? "bg-foreground/[0.14]" : "bg-muted";
  const mid = tone === "contrast" ? "bg-foreground/[0.10]" : "bg-muted/50";
  const soft = tone === "contrast" ? "bg-foreground/[0.07]" : "bg-muted/40";
  // The modal covers the middle, so what a viewer actually sees of this is the
  // MARGINS — thin strips top and bottom, wider ones either side. Eight rows
  // stopped well above the fold and left the lower half plain, which read as
  // "no frosted glass" in both themes. Enough rows to reach the bottom of a
  // tall screen; they cost nothing, being empty divs.
  const rows = tone === "contrast" ? 18 : 8;

  return (
    <div className={animated ? "space-y-8 animate-pulse" : "space-y-8"}>
      <div className={`h-8 w-56 max-w-full rounded-md ${strong}`} />

      <div className="space-y-5">
        {/* View-switcher pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {["w-16", "w-24", "w-20", "w-28", "w-24", "w-24", "w-32"].map(
            (w, i) => (
              <div key={i} className={`h-8 rounded-full ${mid} ${w}`} />
            ),
          )}
        </div>

        {/* Search */}
        <div className={`h-9 w-full rounded-md ${soft} sm:w-72`} />

        {/* Table: hairline above + row dividers, like the worklist. */}
        <div className="border-t border-border">
          <div className="divide-y divide-border/60">
            {Array.from({ length: rows }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3.5">
                <div className={`h-4 flex-1 rounded ${mid}`} />
                <div className={`hidden h-4 w-32 rounded ${soft} sm:block`} />
                <div className={`hidden h-4 w-20 rounded ${soft} md:block`} />
                <div className={`h-4 w-14 rounded ${soft}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

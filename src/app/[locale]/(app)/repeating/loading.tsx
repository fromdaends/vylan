// Route skeleton — mirrors the real layout so the page doesn't jump when it
// lands: title block, filter chips, toolbar, then hairline rows.
export default function RepeatingLoading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted/60" />
      </div>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-8 w-28 animate-pulse rounded-full bg-muted/70" />
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <div className="h-9 w-44 animate-pulse rounded-md bg-muted/60" />
          <div className="h-9 sm:w-72 animate-pulse rounded-md bg-muted/60" />
        </div>
        <div className="border-l-2 border-accent/40 pl-4 sm:pl-5">
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="mt-3 divide-y divide-border border-t border-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 py-4">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-52 max-w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-32 animate-pulse rounded bg-muted/60" />
                </div>
                <div className="hidden h-4 w-36 animate-pulse rounded bg-muted/60 sm:block" />
                <div className="hidden h-4 w-28 animate-pulse rounded bg-muted/60 sm:block" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

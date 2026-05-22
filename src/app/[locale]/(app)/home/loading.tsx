export default function Loading() {
  return (
    <div className="space-y-10 sm:space-y-12 animate-pulse">
      <div className="flex items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="h-12 sm:h-14 w-80 max-w-full bg-muted rounded-md" />
          <div className="h-4 w-60 max-w-full bg-muted/60 rounded-md" />
        </div>
        <div className="h-9 w-40 bg-muted/40 rounded-md" />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-xl border border-border bg-card divide-y divide-border/60">
          <div className="h-14 bg-muted/20" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted/15" />
          ))}
        </div>
        <div className="lg:col-span-2 space-y-6">
          <div className="h-11 bg-muted/40 rounded-md" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-border bg-card divide-y divide-border/60"
            >
              <div className="h-12 bg-muted/20" />
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-12 bg-muted/15" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

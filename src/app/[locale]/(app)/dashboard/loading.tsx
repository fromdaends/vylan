// Dashboard skeleton: title, 4 metric tiles, filter-chip bar, list rows.

export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-9 w-72 max-w-full bg-muted rounded-md" />
        <div className="h-4 w-48 max-w-full bg-muted/60 rounded-md" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted/40 rounded-xl" />
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border/60 px-3 py-3 flex gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-7 w-24 bg-muted/40 rounded-full" />
          ))}
        </div>
        <div className="px-5 py-2 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted/30 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

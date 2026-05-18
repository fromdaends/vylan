// AI activity skeleton: back link, title, list rows.

export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-4 w-24 bg-muted/60 rounded-md" />
      <div className="space-y-2">
        <div className="h-9 w-64 max-w-full bg-muted rounded-md" />
        <div className="h-4 w-80 max-w-full bg-muted/60 rounded-md" />
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border/60">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 bg-muted/30" />
        ))}
      </div>
    </div>
  );
}

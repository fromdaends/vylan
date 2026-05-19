export default function Loading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-pulse">
      <div className="h-4 w-32 bg-muted/60 rounded-md" />
      <div className="space-y-2">
        <div className="h-9 w-72 bg-muted rounded-md" />
        <div className="h-4 w-96 max-w-full bg-muted/60 rounded-md" />
      </div>
      <div className="flex gap-3">
        <div className="h-9 w-60 bg-muted/40 rounded-md" />
        <div className="h-9 w-72 bg-muted/40 rounded-md" />
      </div>
      <div className="rounded-xl border border-border bg-card divide-y divide-border/60">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-14 bg-muted/20" />
        ))}
      </div>
    </div>
  );
}

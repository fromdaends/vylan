// New-engagement builder skeleton — without this, the parent Engagements list
// skeleton (../loading.tsx) would flash on the create form during a cold
// navigation. Generic stacked-field shape, centered like the builder.

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-pulse">
      <div className="h-4 w-24 rounded-md bg-muted/60" />
      <div className="space-y-2">
        <div className="h-8 w-64 max-w-full rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full rounded-md bg-muted/60" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-4 w-28 rounded bg-muted/50" />
            <div className="h-10 w-full rounded-md bg-muted/40" />
          </div>
        ))}
      </div>
    </div>
  );
}

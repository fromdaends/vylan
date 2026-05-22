export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-1 pt-10 sm:pt-14 pb-16 space-y-8 animate-pulse">
      <div className="h-4 w-24 bg-muted/40 rounded-sm" />
      <div className="space-y-2">
        <div className="h-9 sm:h-10 w-52 bg-muted rounded-md" />
        <div className="h-4 w-72 max-w-full bg-muted/60 rounded-md" />
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-16 bg-muted/15" />
        ))}
      </div>
    </div>
  );
}

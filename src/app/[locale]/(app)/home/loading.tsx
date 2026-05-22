export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-1 pt-16 sm:pt-24 pb-16 space-y-14 sm:space-y-16 animate-pulse">
      {/* Greeting */}
      <div className="space-y-3 text-center">
        <div className="mx-auto h-12 sm:h-14 w-80 max-w-full bg-muted rounded-md" />
        <div className="mx-auto h-4 w-60 max-w-full bg-muted/60 rounded-md" />
      </div>
      {/* Search */}
      <div className="h-12 w-full bg-muted/40 rounded-full" />
      {/* What's new */}
      <div className="space-y-4">
        <div className="h-3 w-24 bg-muted/40 rounded-sm" />
        <div className="divide-y divide-border/60">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-muted/15" />
          ))}
        </div>
      </div>
      {/* Quick links */}
      <div className="flex justify-center gap-5 pt-4 border-t border-border/40">
        <div className="h-4 w-24 bg-muted/30 rounded-sm" />
        <div className="h-4 w-40 bg-muted/30 rounded-sm" />
        <div className="h-4 w-32 bg-muted/30 rounded-sm" />
      </div>
    </div>
  );
}

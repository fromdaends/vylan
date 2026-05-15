// Templates-list skeleton: title + a few template cards.

export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-9 w-48 bg-muted rounded-md" />
        <div className="h-4 w-80 max-w-full bg-muted/60 rounded-md" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 bg-muted/40 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

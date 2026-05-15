// Dashboard-shaped skeleton: title, 5 stat tiles, list of engagement cards.

export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-9 w-72 max-w-full bg-muted rounded-md" />
        <div className="h-4 w-96 max-w-full bg-muted/60 rounded-md" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted/40 rounded-lg" />
        ))}
      </div>
      <div className="space-y-3">
        <div className="h-20 bg-muted/40 rounded-lg" />
        <div className="h-20 bg-muted/40 rounded-lg" />
        <div className="h-20 bg-muted/40 rounded-lg" />
        <div className="h-20 bg-muted/40 rounded-lg" />
      </div>
    </div>
  );
}

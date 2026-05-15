// Settings skeleton: title + appearance grid + language toggle + firm
// pref toggle + billing card.

export default function Loading() {
  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-9 w-32 bg-muted rounded-md" />
        <div className="h-4 w-72 max-w-full bg-muted/60 rounded-md" />
      </div>

      <div className="space-y-4">
        <div className="h-4 w-32 bg-muted/40 rounded-md" />
        <div className="grid grid-cols-3 gap-2 max-w-sm">
          <div className="h-20 bg-muted/40 rounded-md" />
          <div className="h-20 bg-muted/40 rounded-md" />
          <div className="h-20 bg-muted/40 rounded-md" />
        </div>
      </div>

      <div className="space-y-4">
        <div className="h-4 w-32 bg-muted/40 rounded-md" />
        <div className="h-10 w-48 bg-muted/40 rounded-md" />
      </div>

      <div className="space-y-4">
        <div className="h-4 w-32 bg-muted/40 rounded-md" />
        <div className="h-16 bg-muted/40 rounded-lg max-w-xl" />
      </div>

      <div className="space-y-4">
        <div className="h-4 w-20 bg-muted/40 rounded-md" />
        <div className="h-14 bg-muted/40 rounded-lg max-w-xl" />
      </div>
    </div>
  );
}

// Firm-settings skeleton: title + the two cards on the real page
// (firm logo, then firm-details form with 4 fields).

export default function Loading() {
  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-9 w-48 bg-muted rounded-md" />
        <div className="h-4 w-80 max-w-full bg-muted/60 rounded-md" />
      </div>

      <div className="space-y-6">
        {/* Firm logo row */}
        <div className="flex items-center gap-4">
          <div className="size-16 bg-muted/40 rounded-md" />
          <div className="h-9 w-32 bg-muted/40 rounded-md" />
        </div>
        {/* Firm-details form rows: name, brand color, timezone, locale */}
        <div className="space-y-2">
          <div className="h-4 w-24 bg-muted/40 rounded-md" />
          <div className="h-10 bg-muted/40 rounded-md max-w-sm" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-24 bg-muted/40 rounded-md" />
          <div className="h-10 bg-muted/40 rounded-md max-w-sm" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-24 bg-muted/40 rounded-md" />
          <div className="h-10 bg-muted/40 rounded-md max-w-sm" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-24 bg-muted/40 rounded-md" />
          <div className="h-10 bg-muted/40 rounded-md max-w-sm" />
        </div>
      </div>
    </div>
  );
}

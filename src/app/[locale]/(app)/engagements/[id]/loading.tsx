// Engagement-detail-shaped skeleton: back link, title row with action
// buttons, two-column layout for checklist + activity timeline.

export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-4 w-24 bg-muted/60 rounded-md" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="h-9 w-80 max-w-full bg-muted rounded-md" />
          <div className="h-5 w-64 max-w-full bg-muted/60 rounded-md" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 bg-muted/40 rounded-md" />
          <div className="h-9 w-24 bg-muted/40 rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="h-12 bg-muted/40 rounded-lg" />
          <div className="h-16 bg-muted/40 rounded-lg" />
          <div className="h-16 bg-muted/40 rounded-lg" />
          <div className="h-16 bg-muted/40 rounded-lg" />
          <div className="h-16 bg-muted/40 rounded-lg" />
        </div>
        <div className="space-y-3">
          <div className="h-64 bg-muted/40 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

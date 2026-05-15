// Generic skeleton shown while any (app) page's data loads.
// Next.js renders this immediately on Link navigation, so the user
// sees the app shell + content placeholders in <50ms even when the
// real page takes longer to fetch its data.
//
// Page-specific loading.tsx files (dashboard, engagements/[id], etc.)
// override this for routes where a content-shaped skeleton makes the
// transition feel even less jarring.

export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-9 w-64 max-w-full bg-muted rounded-md" />
        <div className="h-4 w-96 max-w-full bg-muted/60 rounded-md" />
      </div>
      <div className="space-y-3">
        <div className="h-28 bg-muted/40 rounded-lg" />
        <div className="h-28 bg-muted/40 rounded-lg" />
        <div className="h-28 bg-muted/40 rounded-lg" />
      </div>
    </div>
  );
}

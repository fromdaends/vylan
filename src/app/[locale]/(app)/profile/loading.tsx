// Profile skeleton: title + avatar/name/email/password/MFA rows.
// Firm settings (logo + brand color + timezone + client language) now
// live on /firm and have their own skeleton.

export default function Loading() {
  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-pulse">
      <div className="space-y-2">
        <div className="h-9 w-48 bg-muted rounded-md" />
        <div className="h-4 w-80 max-w-full bg-muted/60 rounded-md" />
      </div>

      <div className="space-y-6">
        {/* Avatar row */}
        <div className="flex items-center gap-4">
          <div className="size-16 bg-muted/40 rounded-full" />
          <div className="h-9 w-32 bg-muted/40 rounded-md" />
        </div>
        {/* Name + email + password + MFA placeholders */}
        <div className="h-20 bg-muted/40 rounded-md" />
        <div className="h-20 bg-muted/40 rounded-md" />
        <div className="h-12 bg-muted/40 rounded-md" />
        <div className="h-12 bg-muted/40 rounded-md" />
      </div>
    </div>
  );
}

import { Repeat } from "lucide-react";

// The "Recurring" chip for engagements that belong to a series. Purely
// presentational (label passed in) so it renders identically from Server
// Components (engagement page, client page) and Client Components (worklist
// rows). Design tokens only — correct in both themes.
export function RecurringBadge({
  label,
  compact = false,
}: {
  label: string;
  // Icon-only (label becomes the tooltip + sr-only text) for dense list rows.
  compact?: boolean;
}) {
  return (
    <span
      title={label}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      <Repeat className="size-3" aria-hidden />
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

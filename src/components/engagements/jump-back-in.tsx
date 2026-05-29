import { Link } from "@/i18n/navigation";
import { History, ArrowRight } from "lucide-react";

// Word-style "Jump back in" strip shown under the engagement header — a quick
// hop to the firm's newest other engagement so you can resume where you were.
// Presentational only; the page picks the target.
export function JumpBackIn({
  engagementId,
  title,
  clientName,
  label,
}: {
  engagementId: string;
  title: string;
  clientName: string | null;
  label: string;
}) {
  return (
    <Link
      href={`/engagements/${engagementId}`}
      className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card/60 px-4 py-3 transition-all hover:border-foreground/20 hover:bg-secondary/40"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <History className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-sm font-medium text-foreground">
          {clientName ? `${title} · ${clientName}` : title}
        </div>
      </div>
      <ArrowRight
        className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
        aria-hidden
      />
    </Link>
  );
}

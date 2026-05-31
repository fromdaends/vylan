import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import {
  AlertTriangle,
  Clock,
  FileWarning,
  CheckCheck,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import { selectNeedsAttentionRows } from "@/lib/dashboard/worklist-select";

const MAX_VISIBLE = 5;

// The single reason we surface per row in the Needs-attention block — the most
// urgent one, matching the prioritisation: overdue > due soon > quiet > ready
// to review. Each maps to the same wording the engagement rows already use
// (Attention namespace), so the badges read consistently across the app.
type ReasonKind = "overdue" | "due_soon" | "stale" | "ready";

function primaryReason(r: WorklistRow): ReasonKind | null {
  if (r.reasons.includes("overdue")) return "overdue";
  if (r.reasons.includes("due_soon")) return "due_soon";
  if (r.reasons.includes("stale")) return "stale";
  if (r.readyToReview) return "ready";
  return null;
}

// Needs attention — the prominent, accent-tinted action block near the top of
// the Overview. Visually distinct from the My-engagements table (it's the
// urgent subset). Shows the top few; "View all" links to the full engagements
// list when there are more. Calm, compact empty state.
export async function NeedsAttention({ rows }: { rows: WorklistRow[] }) {
  const t = await getTranslations("Attention");
  const tDash = await getTranslations("Dashboard");

  const items = selectNeedsAttentionRows(rows);
  const visible = items.slice(0, MAX_VISIBLE);
  const overflow = items.length - visible.length;

  return (
    <section
      aria-labelledby="needs-attention-title"
      className="rounded-2xl border border-accent/30 bg-accent/[0.06] p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="needs-attention-title"
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground"
        >
          <AlertTriangle className="h-4 w-4 text-accent" aria-hidden />
          {t("needs_attention")}
          {items.length > 0 && (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent/20 px-1.5 text-xs font-semibold tabular-nums text-accent">
              {items.length}
            </span>
          )}
        </h2>
        {overflow > 0 && (
          <Link
            href="/engagements"
            className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent transition-colors hover:text-accent/80"
          >
            {tDash("wl_view_all")}
            <ChevronRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("all_caught_up")}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {visible.map((r) => (
            <NeedsAttentionRow key={r.id} row={r} t={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NeedsAttentionRow({
  row,
  t,
}: {
  row: WorklistRow;
  t: Awaited<ReturnType<typeof getTranslations<"Attention">>>;
}) {
  const kind = primaryReason(row);
  const badge = kind ? reasonBadge(kind, row, t) : null;

  return (
    <li>
      <Link
        href={`/engagements/${row.id}`}
        className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent/10"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {row.title}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {row.clientName}
          </div>
        </div>
        {badge && (
          <span
            className={
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
              badge.tone
            }
          >
            <badge.Icon className="h-3 w-3" aria-hidden />
            {badge.label}
          </span>
        )}
        <ChevronRight
          className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground/70"
          aria-hidden
        />
      </Link>
    </li>
  );
}

function reasonBadge(
  kind: ReasonKind,
  row: WorklistRow,
  t: Awaited<ReturnType<typeof getTranslations<"Attention">>>,
): { label: string; Icon: LucideIcon; tone: string } {
  switch (kind) {
    case "overdue":
      return {
        label: t("overdue_by", { days: row.daysOverdue ?? 0 }),
        Icon: AlertTriangle,
        tone: "bg-destructive/15 text-destructive",
      };
    case "due_soon":
      return {
        label: t("due_in", { days: row.daysUntilDue ?? 0 }),
        Icon: Clock,
        tone: "bg-warning/15 text-warning",
      };
    case "stale":
      return {
        label: t("stale_days", { days: row.daysSinceClientActivity ?? 0 }),
        Icon: FileWarning,
        tone: "bg-muted text-muted-foreground",
      };
    case "ready":
      return {
        label: t("items_ready", { count: row.itemsReadyToReview }),
        Icon: CheckCheck,
        tone: "bg-success/15 text-success",
      };
  }
}

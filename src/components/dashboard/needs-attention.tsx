import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { ChevronRight } from "lucide-react";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import { selectNeedsAttentionRows } from "@/lib/dashboard/worklist-select";
import { NeedsAttentionRow } from "@/components/dashboard/needs-attention-row";
import { NeedsAttentionCollapsible } from "@/components/dashboard/needs-attention-collapsible";

const MAX_VISIBLE = 5;

// Needs attention — the prominent, accent-tinted action block near the top of
// the Overview. Visually distinct from the My-engagements table (it's the
// urgent subset). Shows the top few; "View all" links to the full engagements
// list when there are more. Calm, compact empty state. Each row carries the
// same right-click / "..." Open-Archive-Delete menu as the My-engagements rows
// (NeedsAttentionRow is a client component reusing useEngagementRowMenu).
export async function NeedsAttention({
  rows,
  canDelete,
}: {
  rows: WorklistRow[];
  canDelete: boolean;
}) {
  const t = await getTranslations("Attention");
  const tDash = await getTranslations("Dashboard");
  const tEng = await getTranslations("Engagements");

  const items = selectNeedsAttentionRows(rows);
  const visible = items.slice(0, MAX_VISIBLE);
  const overflow = items.length - visible.length;

  const viewAll =
    overflow > 0 ? (
      <Link
        href="/engagements"
        className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-accent transition-colors hover:text-accent/80"
      >
        {tDash("wl_view_all")}
        <ChevronRight className="h-3 w-3" aria-hidden />
      </Link>
    ) : null;

  return (
    <NeedsAttentionCollapsible
      title={t("needs_attention")}
      count={items.length}
      viewAll={viewAll}
    >
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("all_caught_up")}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {visible.map((r) => (
            <NeedsAttentionRow
              key={r.id}
              row={r}
              canDelete={canDelete}
              menuActionsLabel={tEng("menu_actions")}
              badge={badgeProps(r, t)}
            />
          ))}
        </ul>
      )}
    </NeedsAttentionCollapsible>
  );
}

// The single reason we surface per row — the most urgent one, matching the
// prioritisation: overdue > due soon > quiet > ready to review. Resolved on the
// server (so the row badge wording reuses the Attention namespace) and passed
// to the client row as plain props.
type ReasonKind = "overdue" | "due_soon" | "stale" | "ready";

function primaryReason(r: WorklistRow): ReasonKind | null {
  if (r.reasons.includes("overdue")) return "overdue";
  if (r.reasons.includes("due_soon")) return "due_soon";
  if (r.reasons.includes("stale")) return "stale";
  if (r.readyToReview) return "ready";
  return null;
}

export type NeedsAttentionBadge = {
  label: string;
  iconKey: ReasonKind;
  tone: string;
};

function badgeProps(
  row: WorklistRow,
  t: Awaited<ReturnType<typeof getTranslations<"Attention">>>,
): NeedsAttentionBadge | null {
  const kind = primaryReason(row);
  if (!kind) return null;
  switch (kind) {
    case "overdue":
      return {
        label: t("overdue_by", { days: row.daysOverdue ?? 0 }),
        iconKey: "overdue",
        tone: "bg-destructive/15 text-destructive",
      };
    case "due_soon":
      return {
        label: t("due_in", { days: row.daysUntilDue ?? 0 }),
        iconKey: "due_soon",
        tone: "bg-warning/15 text-warning",
      };
    case "stale":
      return {
        label: t("stale_days", { days: row.daysSinceClientActivity ?? 0 }),
        iconKey: "stale",
        tone: "bg-muted text-muted-foreground",
      };
    case "ready":
      return {
        label: t("items_ready", { count: row.itemsReadyToReview }),
        iconKey: "ready",
        tone: "bg-success/15 text-success",
      };
  }
}

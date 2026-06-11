import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import { selectNeedsAttentionRows } from "@/lib/dashboard/worklist-select";
import { NeedsAttentionRow } from "@/components/dashboard/needs-attention-row";

const MAX_VISIBLE = 5;

// Needs attention — the prominent, accent-tinted action block in the top
// region of the Overview. The actionable to-do list: every engagement that
// requires the ACCOUNTANT to act, with a reason chip per signal (ready to
// review, flagged files, signed copy to confirm, sitting unreviewed, overdue /
// due soon / quiet). One row per engagement, multiple chips when multiple
// reasons apply. Shows the top few; "View all" links to the full engagements
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

  // Always expanded — this is the most useful block on the page, so there is
  // deliberately no collapse toggle (an earlier chevron + saved preference
  // used to bury the to-do list; both are gone).
  return (
    <section
      aria-labelledby="needs-attention-title"
      className="border-l-2 border-accent/40 pl-4 sm:pl-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="needs-attention-title"
          className="flex min-w-0 items-center gap-2 text-base font-semibold tracking-tight text-foreground"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span className="truncate">{t("needs_attention")}</span>
          {items.length > 0 && (
            <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 px-1.5 text-xs font-semibold tabular-nums text-accent">
              {items.length}
            </span>
          )}
        </h2>
        {viewAll}
      </div>

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
              badges={badgesFor(r, t)}
              // Flagged uploads are reviewed in the Preview overlay's Flagged
              // tab — land there directly. Every other reason lands on the
              // engagement page itself.
              href={
                r.flaggedFilesCount > 0
                  ? `/engagements/${r.id}?preview=flagged`
                  : `/engagements/${r.id}`
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

// The reason chips on one row, in display order: hard deadlines first, then
// the review queue signals, then the soft chase signals. One chip per signal
// that applies — never duplicate rows, one row per engagement.
type ReasonKind =
  | "overdue"
  | "sitting"
  | "flagged"
  | "signed_copy"
  | "ready"
  | "due_soon"
  | "stale";

export type NeedsAttentionBadge = {
  label: string;
  iconKey: ReasonKind;
  tone: string;
};

function badgesFor(
  row: WorklistRow,
  t: Awaited<ReturnType<typeof getTranslations<"Attention">>>,
): NeedsAttentionBadge[] {
  const badges: NeedsAttentionBadge[] = [];
  if (row.reasons.includes("overdue")) {
    badges.push({
      label: t("overdue_by", { days: row.daysOverdue ?? 0 }),
      iconKey: "overdue",
      tone: "bg-destructive/15 text-destructive",
    });
  }
  if (row.sittingUnreviewed) {
    badges.push({
      label: t("chip_sitting", { days: row.waitingDays ?? 0 }),
      iconKey: "sitting",
      tone: "bg-warning/15 text-warning",
    });
  }
  if (row.flaggedFilesCount > 0) {
    badges.push({
      label: t("chip_flagged", { count: row.flaggedFilesCount }),
      iconKey: "flagged",
      tone: "bg-warning/15 text-warning",
    });
  }
  if (row.signedCopiesToConfirm > 0) {
    badges.push({
      label: t("chip_signed_copy", { count: row.signedCopiesToConfirm }),
      iconKey: "signed_copy",
      tone: "bg-accent/15 text-accent",
    });
  }
  if (row.readyToReview) {
    badges.push({
      label:
        row.itemsReadyToReview > 0
          ? t("items_ready", { count: row.itemsReadyToReview })
          : t("chip_ready"),
      iconKey: "ready",
      tone: "bg-success/15 text-success",
    });
  }
  if (row.reasons.includes("due_soon")) {
    badges.push({
      label: t("due_in", { days: row.daysUntilDue ?? 0 }),
      iconKey: "due_soon",
      tone: "bg-warning/15 text-warning",
    });
  }
  if (row.reasons.includes("stale")) {
    badges.push({
      label: t("stale_days", { days: row.daysSinceClientActivity ?? 0 }),
      iconKey: "stale",
      tone: "bg-muted text-muted-foreground",
    });
  }
  return badges;
}

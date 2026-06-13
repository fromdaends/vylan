import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { WorklistRow } from "@/components/dashboard/engagements-worklist";
import { selectNeedsAttentionRows } from "@/lib/dashboard/worklist-select";
import {
  pickAttentionChips,
  type AttentionReason,
} from "@/lib/dashboard/attention-chips";
import { NeedsAttentionRow } from "@/components/dashboard/needs-attention-row";

const MAX_VISIBLE = 5;

// Needs attention — the prominent, accent-tinted action block in the top
// region of the Overview. The actionable to-do list: every engagement that
// requires the ACCOUNTANT to act. Per row, ONE reason wears a colored accent
// chip (pickAttentionChips decides the winner) and every other applicable
// reason renders as quiet muted text — so a row pulls the eye exactly once.
// Shows the top few; "View all" links to the full engagements list when there
// are more. Calm, compact empty state. Each row carries the same right-click /
// "..." Open-Archive-Delete menu as the My-engagements rows
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
          {visible.map((r) => {
            const chips = pickAttentionChips(r);
            return (
              <NeedsAttentionRow
                key={r.id}
                row={r}
                canDelete={canDelete}
                menuActionsLabel={tEng("menu_actions")}
                accent={
                  chips.accent
                    ? {
                        label: labelFor(chips.accent, r, t),
                        iconKey: chips.accent,
                        tone: ACCENT_TONES[chips.accent],
                      }
                    : null
                }
                context={chips.context.map((reason) => labelFor(reason, r, t))}
                // Flagged uploads are reviewed in the Preview overlay's Flagged
                // tab — land there directly. Every other reason lands on the
                // engagement page itself.
                href={
                  r.flaggedFilesCount > 0
                    ? `/engagements/${r.id}?preview=flagged`
                    : `/engagements/${r.id}`
                }
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

// The one colored accent chip on a row (the most actionable reason —
// pickAttentionChips decides which). Everything else renders as muted text.
export type NeedsAttentionBadge = {
  label: string;
  iconKey: AttentionReason;
  tone: string;
};

// Tone for whichever reason wins the accent. Same palette the chips always
// used — red deadline, green ready, amber flags/due-soon, blue signature.
// (The passive reasons keep entries for type completeness; they never win.)
const ACCENT_TONES: Record<AttentionReason, string> = {
  overdue: "bg-destructive/15 text-destructive",
  ready: "bg-success/15 text-success",
  flagged: "bg-warning/15 text-warning",
  signed_copy: "bg-accent/15 text-accent",
  due_soon: "bg-warning/15 text-warning",
  sitting: "bg-muted text-muted-foreground",
  stale: "bg-muted text-muted-foreground",
};

function labelFor(
  reason: AttentionReason,
  row: WorklistRow,
  t: Awaited<ReturnType<typeof getTranslations<"Attention">>>,
): string {
  switch (reason) {
    case "overdue":
      return t("overdue_by", { days: row.daysOverdue ?? 0 });
    case "sitting":
      return t("chip_sitting", { days: row.waitingDays ?? 0 });
    case "flagged":
      return t("chip_flagged", { count: row.flaggedFilesCount });
    case "signed_copy":
      return t("chip_signed_copy", { count: row.signedCopiesToConfirm });
    case "ready":
      return row.itemsReadyToReview > 0
        ? t("items_ready", { count: row.itemsReadyToReview })
        : t("chip_ready");
    case "due_soon":
      return t("due_in", { days: row.daysUntilDue ?? 0 });
    case "stale":
      return t("stale_days", { days: row.daysSinceClientActivity ?? 0 });
  }
}

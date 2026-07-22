import { getTranslations } from "next-intl/server";
import { ArrowDownLeft, ArrowUpRight, HelpCircle, TriangleAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { formatCurrency, formatNumber, type AppLocale } from "@/lib/format";
import type { FirmDraftRow } from "@/lib/db/quickbooks-suggestions";
import {
  QuickbooksDraftCard,
  type DraftCardOptions,
} from "@/components/engagements/quickbooks-draft-card";
import { DraftStatusControls } from "@/components/engagements/draft-status-controls";
import { DeleteDraftControl } from "./delete-draft-control";
import { draftQueueBucket, type QueueBucket } from "@/lib/quickbooks/draft-queue";
import { canApproveDraft } from "@/lib/quickbooks/draft-status";
import { QueueRowDisclosure } from "./queue-row-disclosure";

// One firm-wide queue row (Stage 4, Phase 3). Compact summary (client /
// engagement / document / amount / bucket pill + inline Approve/Dismiss/Reopen),
// expandable to the full editable draft card. Server component; the card's own
// footer controls are hidden (showStatusControls=false) so they aren't doubled
// with the row's inline controls.
export async function QueueRow({
  row,
  options,
  locale,
  reviewedByName,
  postedByName,
}: {
  row: FirmDraftRow;
  options: DraftCardOptions;
  locale: AppLocale;
  reviewedByName: string | null;
  postedByName: string | null;
}) {
  const t = await getTranslations("Quickbooks");
  const s = row.suggestion;
  const bucket = draftQueueBucket({
    suggestion: s,
    resolved: row.resolved,
    status: row.status,
  });
  const canApprove = canApproveDraft(s, row.resolved);

  const foreign = s.currency != null && s.currency !== "CAD";
  const amountLabel =
    s.amount == null
      ? "—"
      : foreign && s.currency
        ? `${formatNumber(s.amount, locale, 2)} ${s.currency}`
        : formatCurrency(s.amount, locale);

  const DirectionIcon =
    s.direction === "expense"
      ? ArrowDownLeft
      : s.direction === "income"
        ? ArrowUpRight
        : HelpCircle;

  const bucketPill: Record<QueueBucket, { label: string; cls: string }> = {
    needs_input: { label: t("bucket_needs_input"), cls: "bg-warning/10 text-warning" },
    ready: { label: t("bucket_ready"), cls: "bg-accent/10 text-accent" },
    approved: { label: t("status_approved"), cls: "bg-success/10 text-success" },
    posted: { label: t("status_posted"), cls: "bg-accent/10 text-accent" },
    dismissed: { label: t("status_dismissed"), cls: "bg-muted text-muted-foreground" },
  };
  const pill = bucketPill[bucket];

  const summary = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {/* Identity: client + engagement link, then the document. */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-semibold text-foreground truncate max-w-[14rem]">
            {row.clientName ?? t("queue_unknown_client")}
          </span>
          <span aria-hidden className="text-muted-foreground/50">
            ·
          </span>
          <Link
            href={`/engagements/${row.engagementId}`}
            className="text-muted-foreground hover:text-foreground hover:underline truncate max-w-[14rem]"
          >
            {row.engagementTitle ?? t("queue_unknown_engagement")}
          </Link>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <DirectionIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {row.documentName ?? t("queue_unknown_document")}
          </span>
        </div>
      </div>

      {/* Amount. (Who/when is shown in the card when the row is expanded, so
          it isn't duplicated here.) */}
      <div className="text-right tabular-nums">
        <div className="text-sm font-semibold text-foreground">
          {amountLabel}
        </div>
      </div>

      {/* Bucket pill. */}
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
          pill.cls,
        )}
      >
        {bucket === "needs_input" && (
          <TriangleAlert className="h-3 w-3" aria-hidden="true" />
        )}
        {pill.label}
      </span>

      {/* Inline status controls (fast triage) + delete-from-queue. */}
      <DraftStatusControls
        fileId={row.fileId}
        status={row.status}
        canApprove={canApprove}
      />
      <DeleteDraftControl
        fileId={row.fileId}
        status={row.status}
        isMatched={row.matchedQboType != null}
      />
    </div>
  );

  return (
    <QueueRowDisclosure summary={summary}>
      <QuickbooksDraftCard
        suggestion={s}
        resolved={row.resolved}
        options={options}
        locale={locale}
        fileId={row.fileId}
        status={row.status}
        reviewedByName={reviewedByName}
        reviewedAt={row.reviewedAt}
        documentName={row.documentName}
        postedAt={row.postedAt}
        postedByName={postedByName}
        postError={row.postError}
        postedTaxNote={row.postedTaxNote}
        receiptAttachedAt={row.receiptAttachedAt}
        matchedQboType={row.matchedQboType}
        showStatusControls={false}
        provider={row.provider}
      />
    </QueueRowDisclosure>
  );
}

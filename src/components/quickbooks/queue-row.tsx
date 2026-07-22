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
import { QuickbooksLogo } from "@/components/quickbooks/quickbooks-logo";
import { XeroLogo } from "@/components/integrations/xero-logo";
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
  provider,
}: {
  row: FirmDraftRow;
  options: DraftCardOptions;
  locale: AppLocale;
  reviewedByName: string | null;
  postedByName: string | null;
  // EFFECTIVE provider from the live connection (the queue page resolves it);
  // falls back to the stored column when not supplied.
  provider?: "quickbooks" | "xero";
}) {
  const t = await getTranslations("Quickbooks");
  const s = row.suggestion;
  // Which bookkeeping product this draft belongs to (effective live provider,
  // falling back to the stored column) — surfaced as a small brand logo on the
  // collapsed row so the source is scannable at a glance in the mixed queue.
  const eff = provider ?? row.provider;
  const ProviderLogo = eff === "xero" ? XeroLogo : QuickbooksLogo;
  const providerName = eff === "xero" ? "Xero" : "QuickBooks";
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
      {/* Source: which product this draft posts to. A small brand logo so the
          mixed QuickBooks/Xero queue is scannable at a glance. */}
      <span
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary/60 ring-1 ring-inset ring-border/40"
        title={providerName}
        aria-label={providerName}
      >
        <ProviderLogo className="h-3.5 w-3.5" />
      </span>
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
        provider={eff}
      />
    </QueueRowDisclosure>
  );
}

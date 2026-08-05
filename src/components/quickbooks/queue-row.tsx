import { getTranslations } from "next-intl/server";
import { ArrowDownLeft, ArrowUpRight, HelpCircle, TriangleAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { formatCurrency, type AppLocale } from "@/lib/format";
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

  // formatCurrency formats IN the row's own currency now, so a USD draft reads
  // "US$1,234.56" rather than a bare "1,234.56 USD" — and the CAD case is
  // unchanged. The old is-this-foreign branch also mis-handled a firm whose
  // books ARE in USD: not-foreign fell through to a hardcoded CAD symbol.
  const amountLabel = formatCurrency(s.amount, locale, {
    currency: s.currency,
  });

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

  // The row's cells. One <td> per column of the queue table — the column
  // order here MUST match the header in drafts-queue.tsx, and the count must
  // match QUEUE_COLUMN_COUNT (which the expanded row's colSpan uses).
  const summary = (
    <>
      {/* 1. Source: which product this draft posts to. A small brand logo so
             the mixed QuickBooks/Xero queue is scannable at a glance. */}
      <td className="py-2 pl-3 pr-2 align-middle">
        <span
          className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-secondary/60 ring-1 ring-inset ring-border/40"
          title={providerName}
          aria-label={providerName}
        >
          <ProviderLogo className="h-3.5 w-3.5" />
        </span>
      </td>

      {/* 2. Client, with the engagement as its second line (Canopy's
             two-line identity cell) — one column instead of two. */}
      <td className="max-w-[16rem] py-2 pr-3 align-middle">
        <div className="truncate text-sm font-medium text-foreground">
          {row.clientName ?? t("queue_unknown_client")}
        </div>
        <Link
          href={`/engagements/${row.engagementId}`}
          className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {row.engagementTitle ?? t("queue_unknown_engagement")}
        </Link>
      </td>

      {/* 3. Document. Hidden on narrow screens — the identity + amount +
             status are what you triage on. */}
      <td className="hidden max-w-[18rem] py-2 pr-3 align-middle md:table-cell">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <DirectionIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {row.documentName ?? t("queue_unknown_document")}
          </span>
        </div>
      </td>

      {/* 4. Amount, right-aligned and tabular so the column reads as money. */}
      <td className="w-[88px] py-2 pr-3 text-right align-middle text-sm font-medium tabular-nums text-foreground">
        {amountLabel}
      </td>

      {/* 5. Status pill. */}
      <td className="w-[126px] py-2 pr-3 align-middle">
        <span
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
            pill.cls,
          )}
        >
          {bucket === "needs_input" && (
            <TriangleAlert className="h-3 w-3" aria-hidden="true" />
          )}
          {pill.label}
        </span>
      </td>

      {/* 6. Triage controls. They used to sit on every row permanently, which
             is a lot of shouting on a long queue; now they surface on hover
             (and on keyboard focus). Always visible on touch, where there is
             no hover to reveal them. */}
      <td className="w-[82px] py-2 pr-2 align-middle">
        <div className="flex items-center justify-end gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
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
      </td>
    </>
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

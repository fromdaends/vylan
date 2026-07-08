import { getTranslations } from "next-intl/server";
import {
  BookOpen,
  ArrowDownLeft,
  ArrowUpRight,
  HelpCircle,
  TriangleAlert,
} from "lucide-react";
import type {
  TransactionSuggestion,
  ResolvedEntry,
} from "@/lib/quickbooks/suggest";
import {
  effectiveMapping,
  effectiveDate,
  effectiveExpenseMode,
  effectiveSplit,
  effectiveLines,
} from "@/lib/quickbooks/draft-resolve";
import {
  canApproveDraft,
  type DraftStatus,
} from "@/lib/quickbooks/draft-status";
import { quickbooksTaxLinesEnabled } from "@/lib/quickbooks/client";
import { deriveQuickbooksDraftView } from "./quickbooks-draft-view";
import { RegenerateDraftButton } from "./regenerate-draft-button";
import { DraftStatusControls } from "./draft-status-controls";
import { QuickbooksPaidToggle } from "./quickbooks-paid-toggle";
import { QuickbooksSplitSection } from "./quickbooks-split-section";
import { PostDraftControls } from "@/components/quickbooks/post-draft-controls";
import {
  QuickbooksEditableField,
  type PickOption,
} from "./quickbooks-editable-field";
import { QuickbooksDateField } from "./quickbooks-date-field";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  type AppLocale,
} from "@/lib/format";
import { cn } from "@/lib/cn";

export type DraftCardOptions = {
  vendors: PickOption[];
  customers: PickOption[];
  accounts: PickOption[];
  taxCodes: PickOption[];
  items: PickOption[];
  // Bank + credit-card accounts only — the "paid from" options for a Purchase.
  paymentAccounts: PickOption[];
};

// "QuickBooks draft" card (Stage 4). Sits under a receipt / invoice on the
// engagement page. Scannable at a glance:
//   * a header with the title + a match-readiness meter;
//   * a HERO line — the amount, with the expense/income direction and date;
//   * the three mapping targets (vendor/customer, account, tax code) as EDITABLE
//     cells — the accountant picks each from their connected QuickBooks lists;
//     anything still unchosen is highlighted amber.
// Still READ-ONLY on QuickBooks; the picks are only recorded (posting is Stage 5).
export async function QuickbooksDraftCard({
  suggestion,
  resolved,
  options,
  locale,
  fileId,
  status,
  reviewedByName,
  reviewedAt,
  documentName = null,
  postedAt = null,
  postedByName = null,
  postError = null,
  postedTaxNote = null,
  receiptAttachedAt = null,
  matchedQboType = null,
  showStatusControls = true,
}: {
  suggestion: TransactionSuggestion;
  // The accountant's saved picks (null until they edit).
  resolved: ResolvedEntry | null;
  // The firm's cached QuickBooks lists to pick from.
  options: DraftCardOptions;
  locale: AppLocale;
  // The uploaded file this draft belongs to — powers Refresh + the edits.
  fileId: string;
  // Stage 4, Phase 2: the review state + who last acted on it and when.
  status: DraftStatus;
  reviewedByName: string | null;
  reviewedAt: string | null;
  // Stage 4, Phase 3: the source document's name, used as the card title when
  // there's no resolved/matched vendor or customer to name it by.
  documentName?: string | null;
  // Stage 5: post state. postError surfaces a failed post/undo; postedAt/by show
  // when a 'posted' draft was written and by whom.
  postedAt?: string | null;
  postedByName?: string | null;
  postError?: string | null;
  // Stage 5 (tax-line): a tax-discrepancy note on a posted draft (QuickBooks'
  // computed tax vs the document's tax); null when they agree.
  postedTaxNote?: string | null;
  // Stage 5 (receipt-attach): when the source receipt was attached to the posted
  // transaction (null = not attached yet → the card offers an "Attach receipt"
  // retry; a value → "Receipt attached").
  receiptAttachedAt?: string | null;
  // Smart posting part 3: set when this posted draft was MATCHED to a
  // transaction that was already in QuickBooks (its entity type) — the posting
  // row shows the matched label and Undo becomes Unlink. Null = Vylan created
  // the transaction.
  matchedQboType?: string | null;
  // Stage 4, Phase 3: hide the footer Approve/Dismiss/Reopen controls when the
  // surrounding surface already renders them (the firm-wide queue row does), so
  // they're not shown twice. Defaults true (the engagement page keeps them).
  showStatusControls?: boolean;
}) {
  const t = await getTranslations("Quickbooks");
  const v = deriveQuickbooksDraftView(suggestion);
  const eff = effectiveMapping(suggestion, resolved);
  // Bill (unpaid) vs Purchase (paid) for an expense — drives the toggle + whether
  // the "paid from" account cell shows.
  const expenseMode = effectiveExpenseMode(suggestion, resolved);
  // Split-across-accounts (expense with ≥2 reconciled line items). Only offered
  // when tax-lines posting is ON — a split posts PRE-TAX per-line amounts and
  // relies on QuickBooks adding the tax, so with tax OFF a split would drop the
  // tax. When split is ON, the single account cell is replaced by the per-line
  // editor.
  const canSplit =
    v.direction === "expense" &&
    (suggestion.lines?.length ?? 0) >= 2 &&
    quickbooksTaxLinesEnabled();
  const isSplit = effectiveSplit(suggestion, resolved);
  const splitLines = canSplit ? effectiveLines(suggestion, resolved) : [];
  const readinessPct = Math.round(v.readiness * 100);
  const ready = v.readiness >= 0.7;
  // Once approved or dismissed the draft is LOCKED: the cells become read-only and
  // the Refresh button is hidden. Reopen returns it to an editable draft.
  const isDraft = status === "draft";
  // The transaction date (accountant's override, else the AI's read). Required to
  // post — editable in the hero, amber when missing.
  const effDate = effectiveDate(suggestion, resolved);
  const canApprove = canApproveDraft(suggestion, resolved);
  // Pick the right list for the party: customers for income, vendors otherwise.
  const partyOptions =
    v.partyKind === "customer" ? options.customers : options.vendors;

  // State pill in the header.
  const statusPill =
    status === "posted"
      ? { label: t("status_posted"), cls: "bg-accent/10 text-accent" }
      : status === "approved"
        ? { label: t("status_approved"), cls: "bg-success/10 text-success" }
        : status === "dismissed"
          ? {
              label: t("status_dismissed"),
              cls: "bg-muted text-muted-foreground",
            }
          : { label: t("status_draft"), cls: "bg-muted text-muted-foreground" };

  // "Approved by X · date" / "Dismissed by X · date" footer line (name may be
  // null if the reviewer left the firm — fall back to the bare state label).
  const reviewedDate = reviewedAt
    ? formatDate(reviewedAt, locale, "medium")
    : null;
  let reviewerMeta: string | null = null;
  if (status === "approved") {
    const base = reviewedByName
      ? t("approved_by", { name: reviewedByName })
      : t("status_approved");
    reviewerMeta = reviewedDate ? `${base} · ${reviewedDate}` : base;
  } else if (status === "dismissed") {
    const base = reviewedByName
      ? t("dismissed_by", { name: reviewedByName })
      : t("status_dismissed");
    reviewerMeta = reviewedDate ? `${base} · ${reviewedDate}` : base;
  }

  const directionLabel =
    v.direction === "expense"
      ? t("direction_expense")
      : v.direction === "income"
        ? t("direction_income")
        : t("direction_unknown");
  const DirectionIcon =
    v.direction === "expense"
      ? ArrowDownLeft
      : v.direction === "income"
        ? ArrowUpRight
        : HelpCircle;
  const directionPill =
    v.direction === "income"
      ? "bg-success/10 text-success"
      : v.direction === "unknown"
        ? "bg-warning/10 text-warning"
        : "bg-muted text-muted-foreground";

  const partyLabel =
    v.partyKind === "customer"
      ? t("field_customer")
      : v.partyKind === "vendor"
        ? t("field_vendor")
        : t("field_party");
  const partyChoose =
    v.partyKind === "customer"
      ? t("choose_customer")
      : v.partyKind === "vendor"
        ? t("choose_vendor")
        : t("choose_party");

  const amountLabel =
    v.amount == null
      ? "—"
      : v.foreignCurrency && v.currency
        ? `${formatNumber(v.amount, locale, 2)} ${v.currency}`
        : formatCurrency(v.amount, locale);

  // A descriptive title for this particular entry: the vendor/customer it books
  // to (the accountant's pick, else the AI match), falling back to the source
  // document's name, then a generic label only when neither is known. The small
  // "QuickBooks" kicker above keeps the card's identity; the status pill carries
  // the state, so the title never has to say "draft".
  const cardTitle = eff.party?.name ?? documentName ?? t("draft_title");

  return (
    <div
      className={cn(
        "mt-1.5 overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-sm",
        status === "dismissed" ? "opacity-70" : "",
      )}
    >
      {/* Header: title + state pill + (while a draft) a match-readiness meter. */}
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground leading-none">
            {t("draft_kicker")}
          </div>
          <div className="mt-1 truncate text-sm font-semibold leading-none">
            {cardTitle}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            statusPill.cls,
          )}
        >
          {statusPill.label}
        </span>
        {isDraft && (
          <div
            className="ml-auto flex items-center gap-1.5"
            aria-label={t("readiness", { pct: readinessPct })}
            title={t("readiness", { pct: readinessPct })}
          >
            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  ready ? "bg-success" : "bg-warning",
                )}
                style={{ width: `${readinessPct}%` }}
              />
            </div>
            <span
              className={cn(
                "text-xs font-semibold tabular-nums",
                ready ? "text-success" : "text-warning",
              )}
            >
              {readinessPct}%
            </span>
          </div>
        )}
      </div>

      {/* Hero: the amount, with the direction + date for context. */}
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1 px-3 pt-2.5">
        <div className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
          {amountLabel}
        </div>
        <div className="flex items-center gap-2 pb-0.5 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              directionPill,
            )}
          >
            <DirectionIcon className="h-3 w-3" aria-hidden="true" />
            {directionLabel}
          </span>
          <QuickbooksDateField
            fileId={fileId}
            initial={effDate}
            locale={locale}
            label={t("field_date")}
            prompt={t("date_needed")}
            disabled={!isDraft}
          />
        </div>
      </div>

      {/* The three mapping targets — editable. Anything still unchosen is amber. */}
      <div
        className={cn(
          "grid grid-cols-1 gap-1.5 px-3 pt-2.5 sm:grid-cols-2",
          v.hasTax ? "lg:grid-cols-3" : "",
        )}
      >
        {/* The key encodes the current effective value so a server data change
            (e.g. after Refresh regenerates the suggestion) remounts the field
            with the fresh value instead of leaving the picker stale. */}
        <QuickbooksEditableField
          key={`party-${eff.party?.id ?? "none"}`}
          fileId={fileId}
          field="party"
          label={partyLabel}
          options={partyOptions}
          initial={eff.party}
          choosePrompt={partyChoose}
          disabled={!isDraft}
        />
        {/* Income lines post to a product/service ITEM (QuickBooks Invoice);
            expenses post to an account (Bill/Expense). When an expense is SPLIT
            across accounts, the single account cell is replaced by the per-line
            editor below, so hide it here. */}
        {v.direction === "income" ? (
          <QuickbooksEditableField
            key={`item-${eff.item?.id ?? "none"}`}
            fileId={fileId}
            field="item"
            label={t("field_item")}
            options={options.items}
            initial={eff.item}
            choosePrompt={t("choose_item")}
            disabled={!isDraft}
          />
        ) : isSplit ? null : (
          <QuickbooksEditableField
            key={`account-${eff.account?.id ?? "none"}`}
            fileId={fileId}
            field="account"
            label={t("field_account")}
            options={options.accounts}
            initial={eff.account}
            choosePrompt={t("choose_account")}
            disabled={!isDraft}
          />
        )}
        {v.hasTax && (
          <QuickbooksEditableField
            key={`tax-${eff.taxCode?.id ?? "none"}`}
            fileId={fileId}
            field="taxCode"
            label={t("field_tax")}
            options={options.taxCodes}
            initial={eff.taxCode}
            choosePrompt={t("confirm_tax")}
            disabled={!isDraft}
          />
        )}
      </div>

      {/* Expense with legible line items: optionally SPLIT across accounts. The
          key re-seeds the client state whenever the server's split flag or any
          per-line effective account changes (e.g. after a Refresh). */}
      {canSplit && (
        <QuickbooksSplitSection
          key={`split-${isSplit}-${splitLines.map((l) => l.account?.id ?? "none").join(",")}`}
          fileId={fileId}
          lines={splitLines}
          split={isSplit}
          accountOptions={options.accounts}
          locale={locale}
          disabled={!isDraft}
        />
      )}

      {/* Expense: was it already paid? A paid receipt posts a Purchase (against a
          bank/credit-card account); an unpaid bill posts a Bill. Income has no
          such choice. */}
      {v.direction === "expense" && (
        <div className="grid grid-cols-1 gap-1.5 px-3 pt-1.5 sm:grid-cols-2">
          <QuickbooksPaidToggle
            key={`paid-${expenseMode}`}
            fileId={fileId}
            mode={expenseMode}
            disabled={!isDraft}
          />
          {expenseMode === "purchase" && (
            <QuickbooksEditableField
              key={`paymentAccount-${eff.paymentAccount?.id ?? "none"}`}
              fileId={fileId}
              field="paymentAccount"
              label={t("field_paid_from")}
              options={options.paymentAccounts}
              initial={eff.paymentAccount}
              choosePrompt={t("choose_paid_from")}
              disabled={!isDraft}
            />
          )}
        </div>
      )}

      {v.foreignCurrency && v.currency && (
        <p className="mt-2 flex items-center gap-1 px-3 text-[11px] text-warning">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          {t("foreign_currency", { currency: v.currency })}
        </p>
      )}

      {/* Footer: while a draft, the read-only hint + Refresh + Approve/Dismiss.
          Once approved/dismissed, who/when + Reopen. */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border/40 px-3 py-2">
        <p className="min-w-0 truncate text-[11px] text-muted-foreground">
          {isDraft ? t("draft_readonly_hint") : reviewerMeta}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {isDraft && <RegenerateDraftButton fileId={fileId} />}
          {showStatusControls && (
            <DraftStatusControls
              fileId={fileId}
              status={status}
              canApprove={canApprove}
            />
          )}
        </div>
      </div>

      {/* Stage 5: posting row — Post to QuickBooks (approved) / Posted + Undo. */}
      {(status === "approved" || status === "posted") && (
        <div className="border-t border-border/40 px-3 py-2">
          <PostDraftControls
            fileId={fileId}
            status={status}
            direction={v.direction}
            expenseMode={expenseMode}
            postedAtLabel={
              postedAt ? formatDate(postedAt, locale, "medium") : null
            }
            postedByName={postedByName}
            postError={postError}
            taxNote={postedTaxNote}
            receiptAttached={receiptAttachedAt != null}
            matchedExisting={matchedQboType != null}
            locale={locale}
          />
        </div>
      )}
    </div>
  );
}

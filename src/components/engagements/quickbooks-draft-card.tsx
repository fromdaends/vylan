import { getTranslations } from "next-intl/server";
import {
  BookOpen,
  ArrowDownLeft,
  ArrowUpRight,
  HelpCircle,
  TriangleAlert,
} from "lucide-react";
import type { TransactionSuggestion } from "@/lib/quickbooks/suggest";
import {
  deriveQuickbooksDraftView,
  type DraftFieldView,
} from "./quickbooks-draft-view";
import { RegenerateDraftButton } from "./regenerate-draft-button";
import { formatCurrency, formatDate, formatNumber, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";

// Read-only "QuickBooks draft" card (Stage 3). Sits under a receipt / invoice on
// the engagement page. Redesigned to be scannable at a glance:
//   * a header with the title + a match-readiness meter;
//   * a HERO line — the amount, with the expense/income direction and date;
//   * the three mapping targets (vendor/customer, account, tax code) as cells,
//     where anything that needs the accountant's pick is highlighted amber.
// Nothing posts to QuickBooks; this is a preview the approval queue (Stage 4)
// will make actionable.
export async function QuickbooksDraftCard({
  suggestion,
  locale,
  fileId,
}: {
  suggestion: TransactionSuggestion;
  locale: AppLocale;
  // The uploaded file this draft belongs to — powers the "Refresh" control.
  fileId: string;
}) {
  const t = await getTranslations("Quickbooks");
  const v = deriveQuickbooksDraftView(suggestion);
  const readinessPct = Math.round(v.readiness * 100);
  const ready = v.readiness >= 0.7;

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

  const archivedLabel = t("archived");

  return (
    <div className="mt-1.5 overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-sm">
      {/* Header: title + draft pill + a match-readiness meter. */}
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold leading-none">
          {t("draft_title")}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("draft_badge")}
        </span>
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
          <span className="text-muted-foreground">
            {v.date ? formatDate(v.date, locale, "medium") : "—"}
          </span>
        </div>
      </div>

      {/* The three mapping targets. Anything still needing a pick is amber. */}
      <div
        className={cn(
          "grid grid-cols-1 gap-1.5 px-3 pt-2.5 sm:grid-cols-2",
          v.hasTax ? "lg:grid-cols-3" : "",
        )}
      >
        <MapField label={partyLabel} field={v.party} choosePrompt={partyChoose} archivedLabel={archivedLabel} />
        <MapField label={t("field_account")} field={v.account} choosePrompt={t("choose_account")} archivedLabel={archivedLabel} />
        {v.hasTax && (
          <MapField label={t("field_tax")} field={v.tax} choosePrompt={t("confirm_tax")} archivedLabel={archivedLabel} />
        )}
      </div>

      {v.foreignCurrency && v.currency && (
        <p className="mt-2 flex items-center gap-1 px-3 text-[11px] text-warning">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          {t("foreign_currency", { currency: v.currency })}
        </p>
      )}

      {/* Footer: read-only reassurance + refresh. */}
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border/40 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {t("draft_readonly_hint")}
        </p>
        <RegenerateDraftButton fileId={fileId} />
      </div>
    </div>
  );
}

// One mapping target as a labelled cell. Matched values read calm; anything the
// accountant still has to choose gets an amber tint + icon so it's obvious at a
// glance what's left to do (never colour alone).
function MapField({
  label,
  field,
  choosePrompt,
  archivedLabel,
}: {
  label: string;
  field: DraftFieldView;
  choosePrompt: string;
  archivedLabel: string;
}) {
  const needsPick = field.state === "ambiguous" || field.state === "none";
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg px-2.5 py-1.5",
        needsPick ? "bg-warning/10" : "bg-muted/50",
      )}
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-sm">
        {field.state === "matched" && (
          <span className="truncate font-medium text-foreground" title={field.name ?? undefined}>
            {field.name}
          </span>
        )}
        {field.state === "matched_archived" && (
          <span className="min-w-0 truncate font-medium text-warning" title={field.name ?? undefined}>
            {field.name}
            <span className="font-normal"> · {archivedLabel}</span>
          </span>
        )}
        {needsPick && (
          <>
            <TriangleAlert className="h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
            <span className="truncate font-medium text-warning">{choosePrompt}</span>
          </>
        )}
      </div>
    </div>
  );
}

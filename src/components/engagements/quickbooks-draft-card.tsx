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
import { effectiveMapping } from "@/lib/quickbooks/draft-resolve";
import { deriveQuickbooksDraftView } from "./quickbooks-draft-view";
import { RegenerateDraftButton } from "./regenerate-draft-button";
import {
  QuickbooksEditableField,
  type PickOption,
} from "./quickbooks-editable-field";
import { formatCurrency, formatDate, formatNumber, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";

export type DraftCardOptions = {
  vendors: PickOption[];
  customers: PickOption[];
  accounts: PickOption[];
  taxCodes: PickOption[];
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
}: {
  suggestion: TransactionSuggestion;
  // The accountant's saved picks (null until they edit).
  resolved: ResolvedEntry | null;
  // The firm's cached QuickBooks lists to pick from.
  options: DraftCardOptions;
  locale: AppLocale;
  // The uploaded file this draft belongs to — powers Refresh + the edits.
  fileId: string;
}) {
  const t = await getTranslations("Quickbooks");
  const v = deriveQuickbooksDraftView(suggestion);
  const eff = effectiveMapping(suggestion, resolved);
  const readinessPct = Math.round(v.readiness * 100);
  const ready = v.readiness >= 0.7;
  // Pick the right list for the party: customers for income, vendors otherwise.
  const partyOptions =
    v.partyKind === "customer" ? options.customers : options.vendors;

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

      {/* The three mapping targets — editable. Anything still unchosen is amber. */}
      <div
        className={cn(
          "grid grid-cols-1 gap-1.5 px-3 pt-2.5 sm:grid-cols-2",
          v.hasTax ? "lg:grid-cols-3" : "",
        )}
      >
        <QuickbooksEditableField
          fileId={fileId}
          field="party"
          label={partyLabel}
          options={partyOptions}
          initial={eff.party}
          choosePrompt={partyChoose}
        />
        <QuickbooksEditableField
          fileId={fileId}
          field="account"
          label={t("field_account")}
          options={options.accounts}
          initial={eff.account}
          choosePrompt={t("choose_account")}
        />
        {v.hasTax && (
          <QuickbooksEditableField
            fileId={fileId}
            field="taxCode"
            label={t("field_tax")}
            options={options.taxCodes}
            initial={eff.taxCode}
            choosePrompt={t("confirm_tax")}
          />
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

import { getTranslations } from "next-intl/server";
import { BookOpen, TriangleAlert } from "lucide-react";
import type { TransactionSuggestion } from "@/lib/quickbooks/suggest";
import {
  deriveQuickbooksDraftView,
  type DraftFieldView,
} from "./quickbooks-draft-view";
import { formatCurrency, formatDate, formatNumber, type AppLocale } from "@/lib/format";

// Read-only "QuickBooks draft" card (Stage 3, Phase 3). Sits under a receipt /
// invoice on the engagement page and shows the mapper's proposed entry —
// vendor/customer, account, tax code, amount, date — each flagged when it needs
// the accountant's eye. NOTHING here posts to QuickBooks; it's a preview the
// approval queue (Stage 4) will make actionable.
//
// In-app "mesh, don't box" styling: a calm tinted panel, not a hard card.
export async function QuickbooksDraftCard({
  suggestion,
  locale,
}: {
  suggestion: TransactionSuggestion;
  locale: AppLocale;
}) {
  const t = await getTranslations("Quickbooks");
  const v = deriveQuickbooksDraftView(suggestion);

  const directionLabel =
    v.direction === "expense"
      ? t("direction_expense")
      : v.direction === "income"
        ? t("direction_income")
        : t("direction_unknown");

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

  const readinessPct = Math.round(v.readiness * 100);

  return (
    <div className="mt-1.5 rounded-lg border border-border/40 bg-muted/30 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-medium">{t("draft_title")}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("draft_badge")}
        </span>
        <span
          className="ml-auto text-[11px] tabular-nums text-muted-foreground"
          aria-label={t("readiness", { pct: readinessPct })}
          title={t("readiness", { pct: readinessPct })}
        >
          {readinessPct}%
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        <Row label={t("field_type")} value={directionLabel} />
        <FieldRow
          label={partyLabel}
          field={v.party}
          choosePrompt={partyChoose}
          archivedLabel={t("archived")}
        />
        <FieldRow
          label={t("field_account")}
          field={v.account}
          choosePrompt={t("choose_account")}
          archivedLabel={t("archived")}
        />
        {v.hasTax && (
          <FieldRow
            label={t("field_tax")}
            field={v.tax}
            choosePrompt={t("confirm_tax")}
            archivedLabel={t("archived")}
          />
        )}
        <Row label={t("field_amount")} value={amountLabel} />
        <Row
          label={t("field_date")}
          value={v.date ? formatDate(v.date, locale, "medium") : "—"}
        />
      </dl>

      {v.foreignCurrency && v.currency && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-warning">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
          {t("foreign_currency", { currency: v.currency })}
        </p>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("draft_readonly_hint")}
      </p>
    </div>
  );
}

// A plain label/value row.
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  );
}

// A mapped-field row: shows the matched name, an "archived" warning, or a
// "needs you to choose" prompt depending on the field state.
function FieldRow({
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
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">
        {field.state === "matched" && (
          <span className="font-medium">{field.name}</span>
        )}
        {field.state === "matched_archived" && (
          <span className="font-medium text-warning" title={archivedLabel}>
            {field.name} · {archivedLabel}
          </span>
        )}
        {(field.state === "ambiguous" || field.state === "none") && (
          <span className="text-warning">{choosePrompt}</span>
        )}
      </dd>
    </div>
  );
}

import { AlertTriangle, CheckCircle2, Landmark } from "lucide-react";
import { formatCurrency, type AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  buildPayoutSplit,
  type PayoutFigures,
  type PayoutFinding,
} from "@/lib/ai/payout-reconcile";

// "Payout breakdown" card. Sits under a payment-processor statement (Stripe,
// Square, PayPal…) on the engagement page, beside where a receipt would show
// its bookkeeping draft.
//
// The problem it solves, visible at a glance: the bank feed shows ONE deposit,
// but the books need that deposit split. This card is the split, already read
// off the statement, with a code-verified check that the pieces add up to the
// deposit. The accountant reads four numbers instead of hunting through a
// twelve-page PDF.
//
// Deliberately NOT a draft entry yet — posting a payout means a multi-line
// journal entry, which neither the QuickBooks nor the Xero writer can build
// today. So this reports; it never claims to have booked anything.

export type PayoutCardData = {
  figures: PayoutFigures;
  processor: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** Arrival/deposit date, when the statement printed one. Dates the entry. */
  payoutDate: string | null;
  currency: string | null;
  findings: PayoutFinding[];
  reconciles: boolean;
  note: string;
};

/**
 * Read the payout block the classifier stored on
 * uploaded_files.ai_extracted_fields.payout into card props. Returns null for
 * every document that isn't a processor statement, for legacy rows written
 * before this feature, and for a read that produced no usable figures — so the
 * card simply doesn't render rather than showing an empty shell.
 *
 * Tolerant by design: the stored shape is jsonb, so every field is checked
 * rather than trusted.
 */
export function payoutCardData(
  extractedFields: unknown,
): PayoutCardData | null {
  const payout = (extractedFields as { payout?: unknown } | null)?.payout;
  if (!payout || typeof payout !== "object") return null;
  const { extraction, reconciliation } = payout as {
    extraction?: unknown;
    reconciliation?: unknown;
  };
  if (!extraction || typeof extraction !== "object") return null;

  const e = extraction as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v : null;

  const figures: PayoutFigures = {
    grossSales: num(e.grossSales),
    refunds: num(e.refunds),
    fees: num(e.fees),
    feeTax: num(e.feeTax),
    adjustments: num(e.adjustments),
    netPayout: num(e.netPayout),
  };
  // Nothing worth showing when neither end of the split was legible.
  if (figures.grossSales == null && figures.netPayout == null) return null;

  const r = (reconciliation ?? {}) as {
    reconciles?: unknown;
    findings?: unknown;
  };
  return {
    figures,
    processor: str(e.processor),
    periodStart: str(e.periodStart),
    periodEnd: str(e.periodEnd),
    payoutDate: str(e.payoutDate),
    currency: str(e.currency),
    findings: Array.isArray(r.findings) ? (r.findings as PayoutFinding[]) : [],
    reconciles: r.reconciles === true,
    note: str(e.note) ?? "",
  };
}

// Deduction lines render as negatives; sales and the net deposit render plain.
const NEGATIVE_KINDS = new Set(["refunds", "fees", "fee_tax", "adjustments"]);

function periodLabel(
  start: string | null,
  end: string | null,
  locale: AppLocale,
): string | null {
  if (!start && !end) return null;
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(
      locale === "fr" ? "fr-CA" : "en-CA",
      { month: "short", day: "numeric", year: "numeric" },
    );
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  return fmt((start ?? end) as string);
}

export function PayoutBreakdownCard({
  data,
  locale,
  journalSlot,
}: {
  data: PayoutCardData;
  locale: AppLocale;
  // The journal-entry half (account mapping + the balanced entry). Rendered
  // by the page when the firm has a bookkeeping connection; omitted otherwise
  // so a firm without QuickBooks/Xero just sees the verified split.
  journalSlot?: React.ReactNode;
}) {
  const lines = buildPayoutSplit(data.figures);
  if (lines.length === 0) return null;

  const fr = locale === "fr";
  const currency = data.currency ?? "CAD";
  const period = periodLabel(data.periodStart, data.periodEnd, locale);
  const netLine = lines.find((l) => l.kind === "net");

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3.5 py-3">
      {/* Header: what this is, which processor, which period. */}
      <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Landmark className="size-3.5 shrink-0 text-icon-blue" aria-hidden />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
          {fr ? "Répartition du versement" : "Payout breakdown"}
        </span>
        {data.processor && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {data.processor}
          </span>
        )}
        {period && (
          <span className="text-[11px] text-muted-foreground">{period}</span>
        )}
        {/* formatCurrency renders CAD symbols; say so plainly when the
            statement is in another currency rather than mislabel it. */}
        {currency !== "CAD" && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
            {currency}
          </span>
        )}
      </div>

      {/* The split. The net row is separated and emphasized — it is the number
          that will appear as one line in the bank feed. */}
      <ul className="space-y-1 text-sm">
        {lines
          .filter((l) => l.kind !== "net")
          .map((l) => (
            <li key={l.kind} className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">
                {fr ? l.label_fr : l.label_en}
              </span>
              <span className="tabular-nums">
                {NEGATIVE_KINDS.has(l.kind) ? "−" : ""}
                {formatCurrency(l.amount, locale)}
              </span>
            </li>
          ))}
      </ul>

      {netLine && (
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-border/50 pt-2 text-sm font-medium">
          <span>{fr ? netLine.label_fr : netLine.label_en}</span>
          <span className="tabular-nums">
            {formatCurrency(netLine.amount, locale)}
          </span>
        </div>
      )}

      {/* The code-verified verdict. Green only when every figure was present
          AND the arithmetic held — never a guess. */}
      <div className="mt-2.5 space-y-1.5 border-t border-border/50 pt-2">
        {data.reconciles ? (
          <div className="flex items-start gap-1.5 text-xs">
            <CheckCircle2
              className="mt-px size-3.5 shrink-0 text-emerald-500"
              aria-hidden
            />
            <span className="text-muted-foreground">
              {fr
                ? "Les montants balancent avec le dépôt."
                : "The amounts add up to the deposit."}
            </span>
          </div>
        ) : (
          data.findings.map((f, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs">
              <AlertTriangle
                className="mt-px size-3.5 shrink-0 text-warning"
                aria-hidden
              />
              <div className="min-w-0">
                <div className="font-medium text-warning">
                  {fr ? f.label_fr : f.label_en}
                </div>
                <div className="text-muted-foreground">
                  {fr ? f.detail_fr : f.detail_en}
                </div>
              </div>
            </div>
          ))
        )}
        {data.note && (
          <p className={cn("text-xs text-muted-foreground")}>{data.note}</p>
        )}
      </div>

      {journalSlot}
    </div>
  );
}

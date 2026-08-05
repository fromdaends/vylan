"use client";

// Canopy's money readout: what each billing cycle comes to, what the whole
// engagement comes to, and what is due the moment the client agrees.
//
// ── ONE PANEL, EVERY SURFACE ───────────────────────────────────────────────
//
// The founder, after seeing Canopy's Billing and payment screen: "Theres no
// screen or way to view pricing and stuff like fully." And then, on how to fix
// it: "Dont make the same mistake again of building new stuff on the engagement
// builder but not transferring it over to other places it exists."
//
// So this is a component, not a block of JSX inside the engagement builder. It
// renders on the engagement's Billing step AND the template builder's Services
// tab, from the same `computeBillingTotals` result, so the two can never
// disagree about what a set of lines adds up to.
//
// ── IT SAYS "TBD" OUT LOUD ─────────────────────────────────────────────────
//
// Canopy writes "hourly billing determined later" against a group with no fixed
// rate, and TBD against its tax and total. Copied deliberately: an unpriced line
// makes the number genuinely unknown, and printing $0.00 would tell a client the
// work is free. Every figure below is either real or is words.

import { useTranslations } from "next-intl";
import type { BillingTotals } from "@/lib/engagements/billing-totals";
import type { BillingFrequency } from "@/lib/engagements/items";
import { formatCurrency, type AppLocale } from "@/lib/format";

type FreqKey =
  | "item_freq_once"
  | "item_freq_weekly"
  | "item_freq_monthly"
  | "item_freq_quarterly"
  | "item_freq_yearly";

export function BillingTotalsPanel({
  totals,
  locale,
  /**
   * What the CLIENT is allowed to see (Canopy's gear menu). The firm's own
   * screens pass nothing and see everything — hiding a total from the
   * accountant who set it would be absurd. The proposal passes the real
   * visibility.
   */
  visibility,
}: {
  totals: BillingTotals;
  locale: AppLocale;
  visibility?: { blockTotals: boolean; total: boolean };
}) {
  const t = useTranslations("Engagements");
  const showGroups = visibility?.blockTotals !== false;
  const showTotal = visibility?.total !== false;

  const money = (cents: number) => formatCurrency(cents / 100, locale);
  const freqLabel = (f: BillingFrequency) => t(`item_freq_${f}` as FreqKey);

  if (totals.groups.length === 0) return null;

  return (
    <div className="space-y-2 text-sm">
      {showGroups &&
        totals.groups.map((g) => (
          <div key={g.frequency} className="space-y-1">
            <Row
              label={t("totals_subtotal_for", { frequency: freqLabel(g.frequency) })}
              // Canopy's exact behaviour: the group that cannot be priced says
              // so in words, in italics, where the number would have been.
              value={
                g.determined ? (
                  money(g.subtotalCents)
                ) : (
                  <span className="italic">{t("totals_determined_later")}</span>
                )
              }
            />
            <Row
              label={t("totals_tax")}
              muted
              value={
                g.determined ? money(g.taxCents) : <span>{t("totals_tbd")}</span>
              }
            />
            <Row
              label={t("totals_total_for", { frequency: freqLabel(g.frequency) })}
              value={
                g.determined ? (
                  money(g.totalCents)
                ) : (
                  <span className="italic">{t("totals_determined_later")}</span>
                )
              }
            />
          </div>
        ))}

      {showTotal && (
        <div className="border-t border-border pt-2">
          <Row
            strong
            label={t("totals_engagement_total")}
            value={
              totals.determined ? (
                money(totals.totalCents)
              ) : (
                <span>{t("totals_tbd")}</span>
              )
            }
          />
        </div>
      )}

      {/* What they pay to make it live. Shown even when the engagement total is
          unknown — you can know the deposit and not yet know the rest. */}
      {totals.dueOnAcceptanceCents != null && (
        <div className="border-t border-border pt-2">
          <p className="mb-1 text-xs font-medium">{t("totals_due_heading")}</p>
          <Row
            strong
            label={t("totals_due_on_acceptance")}
            value={money(totals.dueOnAcceptanceCents)}
          />
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  muted = false,
  strong = false,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className={
          strong
            ? "font-medium"
            : muted
              ? "text-muted-foreground"
              : "text-muted-foreground"
        }
      >
        {label}
      </span>
      <span
        className={
          strong
            ? "shrink-0 font-medium tabular-nums"
            : "shrink-0 tabular-nums text-muted-foreground"
        }
      >
        {value}
      </span>
    </div>
  );
}

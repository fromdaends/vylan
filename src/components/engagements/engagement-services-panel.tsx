"use client";

// The engagement's priced scope, read-only — Canopy's "Services" tab.
//
// Founder, with the screenshots: "copy their UI and the actual process itself,
// like, the way it's structured." Canopy's tab is a BILLING BLOCK ("Billed one
// time · On Acceptance") wrapping a table of Service / Billing Mode / Price
// Unit / Price / Tax, with a Total Value above it.
//
// ── READ-ONLY, ON PURPOSE ──────────────────────────────────────────────────
//
// The editor for these lines lives in the creation wizard, which another
// session owns. This panel SHOWS what was agreed. A second editing surface for
// the same rows is exactly the drift CLAUDE.md's cohesion rule exists to stop,
// and it would be worse here than usual: these numbers are what a client
// agreed to pay.
//
// ── ONE FRAME PER BILLING FREQUENCY ────────────────────────────────────────
//
// groupByFrequency() already splits them, because "billed once" and "billed
// monthly" are different promises and a single total across both is a number
// that means nothing. Canopy draws one block per frequency for the same reason.

import { useTranslations } from "next-intl";
import {
  groupByFrequency,
  totalForItems,
  type EngagementItemDraft,
} from "@/lib/engagements/items";
import { formatCurrency, formatDate, type AppLocale } from "@/lib/format";
import { BillingScheduleMenu } from "@/components/engagements/billing-schedule-menu";

/** What the live schedule for one frequency looks like on screen (1710). */
export type ServiceScheduleState = {
  /** Needed to act on it — pause, resume, end. */
  id: string;
  frequency: string;
  /** ISO date of the next invoice, or null when it is paused/ended. */
  nextChargeOn: string | null;
  status: "active" | "paused" | "ended";
  /** Periods already invoiced. "Billed 3 times so far." */
  chargesSoFar: number;
};

export function EngagementServicesPanel({
  items,
  locale,
  schedules = [],
}: {
  items: EngagementItemDraft[];
  locale: AppLocale;
  /**
   * The recurring arrangements actually running (1710).
   *
   * This panel used to state a promise — "billed monthly" — with nothing behind
   * it: the engagement was invoiced once and no second month was ever charged.
   * Now that a schedule genuinely exists, the panel says which one and when it
   * next fires, because a schedule nobody can see is the same broken promise in
   * a new place.
   */
  schedules?: ServiceScheduleState[];
}) {
  const t = useTranslations("Engagements");
  const scheduleFor = (frequency: string) =>
    schedules.find((s) => s.frequency === frequency) ?? null;

  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("details_no_services")}
      </p>
    );
  }

  const groups = groupByFrequency(items);

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const total = totalForItems(group.items);
        const schedule = scheduleFor(group.frequency);
        return (
          <section
            key={group.frequency}
            className="overflow-hidden rounded-lg border border-border"
          >
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-2.5">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-medium text-foreground">
                {t(`billed_${group.frequency}` as "billed_once")}
                {/* WHEN the next one actually goes out. Without this the word
                    "monthly" is the only evidence anything repeats, which is
                    what it was before there was a schedule behind it. */}
                {schedule?.status === "active" && schedule.nextChargeOn && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("services_next_invoice", {
                      date: formatDate(schedule.nextChargeOn, locale),
                    })}
                  </span>
                )}
                {/* How many periods have actually been billed. The count was
                    already being queried and then rendered nowhere, which is the
                    worst of both — paying for the read and showing nothing. It
                    is also the only place a firm can see that the arrangement is
                    really running rather than merely scheduled. */}
                {schedule != null && schedule.chargesSoFar > 0 && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("services_billed_count", {
                      count: String(schedule.chargesSoFar),
                    })}
                  </span>
                )}
                {schedule?.status === "paused" && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("services_billing_paused")}
                  </span>
                )}
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {t("services_total")}{" "}
                <span className="font-semibold text-foreground">
                  {formatCurrency(total.totalCents / 100, locale)}
                </span>
                {/* ⚠️ AN HOURLY LINE HAS NO KNOWABLE TOTAL, and a total that
                    quietly omits one is a number the client will dispute. Say
                    so, exactly as Canopy does with "hourly billing determined
                    later". */}
                {total.unstatableCount > 0 && (
                  <span className="ml-2 text-xs italic">
                    {t("services_total_partial", {
                      count: String(total.unstatableCount),
                    })}
                  </span>
                )}
                {/* Stop / pause / resume. Sits on the billing group it controls
                    rather than anywhere central, and shows nothing at all when
                    there is no schedule — a one-time group has no repeat to
                    stop. */}
                {schedule && (
                  <span className="ml-2 inline-flex align-middle">
                    <BillingScheduleMenu
                      scheduleId={schedule.id}
                      status={schedule.status}
                    />
                  </span>
                )}
              </span>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">
                      {t("services_col_service")}
                    </th>
                    <th className="px-4 py-2 font-medium">
                      {t("services_col_unit")}
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      {t("services_col_price")}
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      {t("services_col_tax")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item, i) => (
                    <tr
                      key={item.id ?? `${item.name}-${i}`}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-foreground">
                          {item.name}
                        </div>
                        {item.description && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {item.description}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {t(`rate_type_${item.rateType}` as "rate_type_item")}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-foreground">
                        {/* NULL is "not fixed yet", never 0 — a line showing
                            $0.00 has promised the work free. */}
                        {item.rateCents == null
                          ? t("services_rate_tbd")
                          : formatCurrency(item.rateCents / 100, locale)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {item.taxPct == null ? "—" : `${item.taxPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

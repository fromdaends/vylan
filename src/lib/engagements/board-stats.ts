// The four numbers across the top of the capacity board.
//
// ── IT AGGREGATES WHAT YOU CAN SEE ─────────────────────────────────────────
//
// The handoff: "Stats bar aggregates the currently visible (filtered) cards."
// So it takes the cards AFTER filtering, not the whole board. A total that
// ignored the filter would quietly answer a different question from the one the
// chips are asking.
//
// ── ⚠️ MONEY IS PERMISSION-GATED, HOURS ARE NOT ────────────────────────────
//
// The handoff's stats cells read "$4,455 CAD · 27h", money derived from hours
// times a rate. Rates in this codebase are `user_rates.billable_rate_hourly`,
// and the time-tracking work that introduced them locked them down
// deliberately: staff must never see a rate, a labour-cost number or a margin
// (RLS returns nothing to anyone without `rates.manage`).
//
// Printing a dollar total to a junior would leak exactly that, one subtraction
// away — so money appears only when the viewer holds the capability, and
// everybody else gets the same board with hours alone. That is a smaller
// screen, not a broken one: hours are the capacity question this board exists
// to answer.

export type BoardStatsInput = {
  budgetMinutes: number | null;
  actualMinutes: number;
};

export type BoardStats = {
  /** Count of visible cards. */
  workItems: number;
  budgetMinutes: number;
  actualMinutes: number;
  /** Budget − actual. NEGATIVE IS MEANINGFUL and is kept: a firm that has
   *  overrun its planned hours needs to see that, not a floor at zero. */
  remainingMinutes: number;
  /** Null unless the viewer may see rates — see the note above. */
  budgetCents: number | null;
  actualCents: number | null;
  remainingCents: number | null;
};

/**
 * @param cards      the VISIBLE cards, already filtered.
 * @param rateCents  hourly billable rate in cents, or null when the viewer may
 *                   not see money. Null is the safe default: a caller that
 *                   forgets to pass a rate shows hours, never a wrong dollar.
 */
export function computeBoardStats(
  cards: BoardStatsInput[],
  rateCents: number | null = null,
): BoardStats {
  let budgetMinutes = 0;
  let actualMinutes = 0;
  for (const c of cards) {
    // An unbudgeted card contributes 0 to the budget total but still counts as
    // a work item. It cannot contribute a guess — see budget_minutes in 1790.
    budgetMinutes += c.budgetMinutes ?? 0;
    actualMinutes += c.actualMinutes;
  }
  const remainingMinutes = budgetMinutes - actualMinutes;

  const money = (minutes: number) =>
    rateCents == null ? null : Math.round((minutes / 60) * rateCents);

  return {
    workItems: cards.length,
    budgetMinutes,
    actualMinutes,
    remainingMinutes,
    budgetCents: money(budgetMinutes),
    actualCents: money(actualMinutes),
    remainingCents: money(remainingMinutes),
  };
}

/**
 * "6h" · "3h 30m" · "45m" · "—" for null.
 *
 * NOT decimal hours. "3.5h" is a spreadsheet's answer; an accountant reading a
 * capacity board is thinking in hours and minutes, and the handoff's own card
 * footer spells it "3h 30m".
 */
export function formatMinutes(minutes: number | null): string {
  if (minutes == null) return "—";
  const negative = minutes < 0;
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const body = h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
  return negative ? `−${body}` : body;
}

/** Whole hours for the stats bar's compact suffix ("· 77h"). Rounded, because
 *  a header total does not need the minutes and "76.5h" reads as precision the
 *  number does not have. */
export function formatHoursShort(minutes: number): string {
  const negative = minutes < 0;
  const h = Math.round(Math.abs(minutes) / 60);
  return `${negative ? "−" : ""}${h}h`;
}

// ── WHERE A CARD'S BUDGET COMES FROM ───────────────────────────────────────
//
// The founder's ruling: assemble it from the services, not from a number typed
// per engagement. So the catalogue carries a duration per service
// (`firm_services.budget_minutes`, migration 1790) and an engagement's budget
// is the sum across the services it actually picked.
//
// The engagement keeps an override for the job that is genuinely unusual. This
// is the same catalogue-suggests / engagement-owns pair the price and the tax
// rate already use, and it behaves identically: editing the catalogue never
// rewrites a job under way, and a job that disagreed stays disagreeing.

export type BudgetSource = {
  /** `engagements.budget_minutes` — set only when somebody overrode the sum. */
  overrideMinutes: number | null;
  /** Duration of each service on this engagement, `null` where the catalogue
   *  does not say. Not pre-summed: the difference between "no services" and
   *  "services nobody has timed" is the difference between 0h and "—". */
  serviceMinutes: (number | null)[];
};

/**
 * The planned minutes for one engagement, or null when nothing can say.
 *
 * ⚠️ NULL AND ZERO ARE DIFFERENT ANSWERS. Null means nobody knows how long this
 * takes and the card shows "—". Zero would be a claim that it takes no time,
 * which no one has made — and it would drag the board's Remaining total up as
 * though capacity had been freed.
 *
 * A partially-timed engagement DOES return a number: three services where only
 * two are timed is still a better plan than no plan, and the alternative
 * (refuse to total until every service is timed) hides the work that has been
 * done to fill the catalogue in.
 */
export function resolveBudgetMinutes(src: BudgetSource): number | null {
  if (src.overrideMinutes != null) return src.overrideMinutes;
  const known = src.serviceMinutes.filter((m): m is number => m != null);
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}

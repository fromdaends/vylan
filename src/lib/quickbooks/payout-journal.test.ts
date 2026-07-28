import { describe, expect, it } from "vitest";
import {
  buildPayoutJournal,
  journalMemo,
  requiredRolesFor,
  type PayoutMapping,
} from "./payout-journal";
import type { PayoutFigures } from "@/lib/ai/payout-reconcile";

const acct = (id: string, name: string) => ({ id, name });

// The June sample: 5200 − 150 − 237.67 − 30.90 = 4781.43.
function figures(over: Partial<PayoutFigures> = {}): PayoutFigures {
  return {
    grossSales: 5200,
    refunds: 150,
    fees: 237.67,
    feeTax: 30.9,
    adjustments: null,
    netPayout: 4781.43,
    ...over,
  };
}

const FULL: PayoutMapping = {
  bank: acct("1", "Chequing"),
  sales: acct("2", "Sales revenue"),
  fees: acct("3", "Merchant fees"),
  fee_tax: acct("4", "GST/HST receivable"),
  refunds: acct("5", "Sales returns"),
};

const MINIMAL: PayoutMapping = {
  bank: acct("1", "Chequing"),
  sales: acct("2", "Sales revenue"),
  fees: acct("3", "Merchant fees"),
};

function totals(lines: { debitCents: number; creditCents: number }[]) {
  return {
    d: lines.reduce((s, l) => s + l.debitCents, 0),
    c: lines.reduce((s, l) => s + l.creditCents, 0),
  };
}

describe("requiredRolesFor", () => {
  it("always needs bank + sales, and fees whenever any deduction exists", () => {
    expect(requiredRolesFor(figures())).toEqual(["bank", "sales", "fees"]);
    expect(
      requiredRolesFor({
        grossSales: 900,
        refunds: null,
        fees: null,
        feeTax: null,
        adjustments: null,
        netPayout: 900,
      }),
    ).toEqual(["bank", "sales"]);
  });

  it("needs a fees account when only fee tax or adjustments are present", () => {
    expect(
      requiredRolesFor(figures({ fees: 0, feeTax: 12, adjustments: null })),
    ).toContain("fees");
    expect(
      requiredRolesFor(figures({ fees: 0, feeTax: null, adjustments: 40 })),
    ).toContain("fees");
  });
});

describe("buildPayoutJournal", () => {
  it("builds a balanced entry with every role mapped", () => {
    const r = buildPayoutJournal(figures(), FULL);
    if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
    const { lines, balanced, totalDebitCents, totalCreditCents } = r.journal;

    expect(balanced).toBe(true);
    expect(totalDebitCents).toBe(520000);
    expect(totalCreditCents).toBe(520000);

    const byRole = Object.fromEntries(lines.map((l) => [l.role, l]));
    expect(byRole.bank.debitCents).toBe(478143);
    expect(byRole.fees.debitCents).toBe(23767);
    expect(byRole.fee_tax.debitCents).toBe(3090);
    expect(byRole.refunds.debitCents).toBe(15000);
    expect(byRole.sales.creditCents).toBe(520000);
    // Revenue is booked at GROSS — the entire point of the split.
    expect(byRole.sales.debitCents).toBe(0);
  });

  it("REFUSES a payout that doesn't reconcile — no account choice can fix it", () => {
    // The July sample: claims 7845.85 but the math gives 7745.85.
    const r = buildPayoutJournal(
      {
        grossSales: 8450,
        refunds: 320,
        fees: 384.15,
        feeTax: null,
        adjustments: null,
        netPayout: 7845.85,
      },
      FULL,
    );
    expect(r).toEqual({ ok: false, reason: "does_not_reconcile" });
  });

  it("reports exactly which required accounts are missing", () => {
    const r = buildPayoutJournal(figures(), { bank: acct("1", "Chequing") });
    if (r.ok) throw new Error("expected refusal");
    expect(r.reason).toBe("missing_accounts");
    expect(r.missingRoles).toEqual(["sales", "fees"]);
  });

  it("folds unmapped roles into their fallback and still balances", () => {
    const r = buildPayoutJournal(figures(), MINIMAL);
    if (!r.ok) throw new Error("expected ok");
    const { lines, balanced } = r.journal;
    expect(balanced).toBe(true);

    // fee tax folded into the fees account: 237.67 + 30.90 = 268.57 on ONE line.
    const feeLine = lines.find((l) => l.account.id === "3")!;
    expect(feeLine.debitCents).toBe(26857);
    expect(feeLine.description).toContain("Processing fees");
    expect(feeLine.description).toContain("Tax on fees");

    // refunds folded into sales: 5200 credit − 150 debit = 5050 net credit.
    const salesLine = lines.find((l) => l.account.id === "2")!;
    expect(salesLine.creditCents).toBe(505000);
    expect(salesLine.debitCents).toBe(0);

    const t = totals(lines);
    expect(t.d).toBe(t.c);
  });

  it("merges roles sharing one account into a single line", () => {
    // Fees and adjustments both pointed at the same expense account.
    const shared: PayoutMapping = {
      ...MINIMAL,
      adjustments: acct("3", "Merchant fees"),
    };
    const r = buildPayoutJournal(
      figures({ adjustments: 25, netPayout: 4756.43 }),
      shared,
    );
    if (!r.ok) throw new Error("expected ok");
    const onAcct3 = r.journal.lines.filter((l) => l.account.id === "3");
    expect(onAcct3).toHaveLength(1);
    expect(onAcct3[0].debitCents).toBe(23767 + 3090 + 2500);
    expect(r.journal.balanced).toBe(true);
  });

  it("flips the bank line to a CREDIT on a negative payout", () => {
    // Refund-heavy month: 100 − 130 − 5 = −35.
    const r = buildPayoutJournal(
      {
        grossSales: 100,
        refunds: 130,
        fees: 5,
        feeTax: null,
        adjustments: null,
        netPayout: -35,
      },
      FULL,
    );
    if (!r.ok) throw new Error("expected ok");
    const bank = r.journal.lines.find((l) => l.role === "bank")!;
    expect(bank.creditCents).toBe(3500);
    expect(bank.debitCents).toBe(0);
    expect(r.journal.balanced).toBe(true);
  });

  it("balances with no deductions at all", () => {
    const r = buildPayoutJournal(
      {
        grossSales: 900,
        refunds: null,
        fees: null,
        feeTax: null,
        adjustments: null,
        netPayout: 900,
      },
      { bank: acct("1", "Chequing"), sales: acct("2", "Sales") },
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.journal.lines).toHaveLength(2);
    expect(r.journal.balanced).toBe(true);
  });

  it("refuses an entirely empty statement", () => {
    const r = buildPayoutJournal(
      {
        grossSales: 0,
        refunds: 0,
        fees: 0,
        feeTax: null,
        adjustments: null,
        netPayout: 0,
      },
      FULL,
    );
    expect(r).toEqual({ ok: false, reason: "nothing_to_post" });
  });

  it("never emits a zero-amount line", () => {
    const r = buildPayoutJournal(figures({ refunds: 0, netPayout: 4931.43 }), FULL);
    if (!r.ok) throw new Error("expected ok");
    for (const l of r.journal.lines) {
      expect(l.debitCents + l.creditCents).toBeGreaterThan(0);
    }
  });

  it("every line has exactly one side", () => {
    const r = buildPayoutJournal(figures(), FULL);
    if (!r.ok) throw new Error("expected ok");
    for (const l of r.journal.lines) {
      expect(l.debitCents === 0 || l.creditCents === 0).toBe(true);
    }
  });

  it("uses integer cents, immune to float drift", () => {
    // 0.1 + 0.2 style figures that would break a float comparison.
    const r = buildPayoutJournal(
      {
        grossSales: 0.3,
        refunds: 0.1,
        fees: 0.2,
        feeTax: null,
        adjustments: null,
        netPayout: 0,
      },
      FULL,
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.journal.balanced).toBe(true);
    expect(r.journal.totalDebitCents).toBe(30);
  });
});

describe("journalMemo", () => {
  it("names the processor and the period", () => {
    expect(
      journalMemo({
        processor: "Stripe",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      }),
    ).toBe("Stripe payout 2026-06-01 to 2026-06-30");
  });

  it("degrades gracefully without a processor or period", () => {
    expect(
      journalMemo({ processor: null, periodStart: null, periodEnd: null }),
    ).toBe("Payment processor payout");
    expect(
      journalMemo({ processor: "Square", periodStart: null, periodEnd: "2026-07-31" }),
    ).toBe("Square payout 2026-07-31");
  });
});

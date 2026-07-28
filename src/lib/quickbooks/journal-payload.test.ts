import { describe, expect, it } from "vitest";
import {
  buildQboJournalPayload,
  buildXeroJournalPayload,
  centsToDecimal,
  journalDate,
} from "./journal-payload";
import { buildPayoutJournal } from "./payout-journal";
import type { PayoutFigures } from "@/lib/ai/payout-reconcile";

const acct = (id: string, name: string) => ({ id, name });

// The June sample: 5200 − 150 − 237.67 − 30.90 = 4781.43.
const FIGURES: PayoutFigures = {
  grossSales: 5200,
  refunds: 150,
  fees: 237.67,
  feeTax: 30.9,
  adjustments: null,
  netPayout: 4781.43,
};

const MAPPING = {
  bank: acct("bank-1", "Chequing"),
  sales: acct("sales-1", "Sales revenue"),
  fees: acct("fees-1", "Merchant fees"),
};

function journal() {
  const r = buildPayoutJournal(FIGURES, MAPPING);
  if (!r.ok) throw new Error(`builder refused: ${r.reason}`);
  return r.journal;
}

describe("centsToDecimal", () => {
  it("converts without float drift", () => {
    expect(centsToDecimal(478143)).toBe(4781.43);
    expect(centsToDecimal(30)).toBe(0.3);
    expect(centsToDecimal(0)).toBe(0);
  });
});

describe("buildQboJournalPayload", () => {
  it("emits positive amounts with an explicit PostingType per line", () => {
    const p = buildQboJournalPayload({
      journal: journal(),
      memo: "Stripe payout",
      txnDate: "2026-06-30",
    });

    expect(p.TxnDate).toBe("2026-06-30");
    expect(p.PrivateNote).toBe("Stripe payout");

    for (const line of p.Line) {
      expect(line.Amount).toBeGreaterThan(0); // never signed
      expect(line.DetailType).toBe("JournalEntryLineDetail");
      expect(["Debit", "Credit"]).toContain(
        line.JournalEntryLineDetail.PostingType,
      );
      expect(line.JournalEntryLineDetail.AccountRef.value).toBeTruthy();
    }

    // Debits and credits still balance after translation.
    const debits = p.Line.filter(
      (l) => l.JournalEntryLineDetail.PostingType === "Debit",
    ).reduce((s, l) => s + l.Amount, 0);
    const credits = p.Line.filter(
      (l) => l.JournalEntryLineDetail.PostingType === "Credit",
    ).reduce((s, l) => s + l.Amount, 0);
    expect(Math.round(debits * 100)).toBe(Math.round(credits * 100));
    expect(Math.round(credits * 100)).toBe(505000); // sales net of refunds
  });

  it("routes each line to its mapped account", () => {
    const p = buildQboJournalPayload({
      journal: journal(),
      memo: "m",
      txnDate: null,
    });
    const bank = p.Line.find(
      (l) => l.JournalEntryLineDetail.AccountRef.value === "bank-1",
    )!;
    expect(bank.JournalEntryLineDetail.PostingType).toBe("Debit");
    expect(bank.Amount).toBe(4781.43);

    const sales = p.Line.find(
      (l) => l.JournalEntryLineDetail.AccountRef.value === "sales-1",
    )!;
    expect(sales.JournalEntryLineDetail.PostingType).toBe("Credit");
  });

  it("omits TxnDate when there is no date rather than inventing one", () => {
    const p = buildQboJournalPayload({
      journal: journal(),
      memo: "m",
      txnDate: null,
    });
    expect(p.TxnDate).toBeUndefined();
  });
});

describe("buildXeroJournalPayload", () => {
  const codes = new Map([
    ["bank-1", "090"],
    ["sales-1", "200"],
    ["fees-1", "404"],
  ]);

  it("signs line amounts: positive debit, negative credit", () => {
    const r = buildXeroJournalPayload({
      journal: journal(),
      memo: "Stripe payout June",
      txnDate: "2026-06-30",
      codeByAccountId: codes,
    });
    if (!r.ok) throw new Error("expected ok");

    expect(r.payload.Narration).toBe("Stripe payout June");
    expect(r.payload.Date).toBe("2026-06-30");
    expect(r.payload.Status).toBe("POSTED");

    const bank = r.payload.JournalLines.find((l) => l.AccountCode === "090")!;
    expect(bank.LineAmount).toBe(4781.43); // debit, positive

    const sales = r.payload.JournalLines.find((l) => l.AccountCode === "200")!;
    expect(sales.LineAmount).toBe(-5050); // credit, negative

    // The whole journal must sum to zero under Xero's sign convention.
    const sum = r.payload.JournalLines.reduce(
      (s, l) => s + Math.round(l.LineAmount * 100),
      0,
    );
    expect(sum).toBe(0);
  });

  it("addresses lines by CODE, never by account id", () => {
    const r = buildXeroJournalPayload({
      journal: journal(),
      memo: "m",
      txnDate: null,
      codeByAccountId: codes,
    });
    if (!r.ok) throw new Error("expected ok");
    for (const l of r.payload.JournalLines) {
      expect(["090", "200", "404"]).toContain(l.AccountCode);
    }
  });

  it("always produces at least two lines (Xero's minimum)", () => {
    const r = buildXeroJournalPayload({
      journal: journal(),
      memo: "m",
      txnDate: null,
      codeByAccountId: codes,
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.payload.JournalLines.length).toBeGreaterThanOrEqual(2);
  });

  it("REFUSES when an account has no Xero code, naming the accounts", () => {
    const partial = new Map([["bank-1", "090"]]);
    const r = buildXeroJournalPayload({
      journal: journal(),
      memo: "m",
      txnDate: null,
      codeByAccountId: partial,
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected refusal");
    expect(r.reason).toBe("missing_account_codes");
    expect(r.accountNames).toContain("Sales revenue");
    expect(r.accountNames).toContain("Merchant fees");
  });

  it("handles a negative payout (bank becomes a credit)", () => {
    const refundHeavy = buildPayoutJournal(
      {
        grossSales: 100,
        refunds: 130,
        fees: 5,
        feeTax: null,
        adjustments: null,
        netPayout: -35,
      },
      MAPPING,
    );
    if (!refundHeavy.ok) throw new Error("builder refused");
    const r = buildXeroJournalPayload({
      journal: refundHeavy.journal,
      memo: "m",
      txnDate: null,
      codeByAccountId: codes,
    });
    if (!r.ok) throw new Error("expected ok");
    const bank = r.payload.JournalLines.find((l) => l.AccountCode === "090")!;
    expect(bank.LineAmount).toBeLessThan(0); // money left the bank
    const sum = r.payload.JournalLines.reduce(
      (s, l) => s + Math.round(l.LineAmount * 100),
      0,
    );
    expect(sum).toBe(0);
  });
});

describe("journalDate", () => {
  it("prefers the arrival date, then the period end, else nothing", () => {
    expect(
      journalDate({ payoutDate: "2026-07-02", periodEnd: "2026-06-30" }),
    ).toBe("2026-07-02");
    expect(journalDate({ payoutDate: null, periodEnd: "2026-06-30" })).toBe(
      "2026-06-30",
    );
    expect(journalDate({ payoutDate: null, periodEnd: null })).toBeNull();
  });
});

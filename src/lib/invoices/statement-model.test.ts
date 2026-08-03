import { describe, it, expect } from "vitest";
import {
  buildStatementLines,
  statementTotals,
  statementPeriodLabel,
  statementFilename,
  type StatementInvoiceInput,
  type StatementModel,
} from "./statement-model";

const TODAY = new Date("2026-08-03T12:00:00Z");

const INV = (
  over: Partial<StatementInvoiceInput> = {},
): StatementInvoiceInput => ({
  status: "requested",
  amount_cents: 100_00,
  amount_paid_cents: 0,
  due_date: null,
  invoice_number: "INV-0001",
  issue_date: "2026-07-01",
  created_at: "2026-07-01T10:00:00Z",
  engagement_title: "T2 2025",
  ...over,
});

describe("buildStatementLines", () => {
  it("carries the invoice through with what is owed", () => {
    const [line] = buildStatementLines([INV()], TODAY);
    expect(line).toMatchObject({
      invoiceNumber: "INV-0001",
      issuedOn: "2026-07-01",
      totalCents: 100_00,
      paidCents: 0,
      outstandingCents: 100_00,
      status: "unpaid",
    });
  });

  // A statement is a demand for money. Listing an invoice the firm already
  // cancelled invites exactly the phone call it exists to prevent.
  it("leaves void invoices off entirely", () => {
    const lines = buildStatementLines(
      [INV(), INV({ status: "canceled", invoice_number: "INV-0002" })],
      TODAY,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].invoiceNumber).toBe("INV-0001");
  });

  it("reports a paid invoice as settled, not as owing", () => {
    const [line] = buildStatementLines([INV({ status: "paid" })], TODAY);
    expect(line.status).toBe("paid");
    expect(line.outstandingCents).toBe(0);
    // Pre-1310 paid rows have amount_paid_cents = 0, so "paid" has to be
    // derived from the status, not from the ledger total.
    expect(line.paidCents).toBe(100_00);
  });

  it("splits a partial into paid and still-owing", () => {
    const [line] = buildStatementLines(
      [INV({ amount_paid_cents: 40_00 })],
      TODAY,
    );
    expect(line).toMatchObject({
      paidCents: 40_00,
      outstandingCents: 60_00,
      status: "partly_paid",
    });
  });

  it("marks an overdue invoice, and only past its due date", () => {
    const [late] = buildStatementLines(
      [INV({ due_date: "2026-07-15" })],
      TODAY,
    );
    expect(late.status).toBe("overdue");
    const [notYet] = buildStatementLines(
      [INV({ due_date: "2026-08-31" })],
      TODAY,
    );
    expect(notYet.status).toBe("unpaid");
  });

  it("never calls a settled invoice overdue", () => {
    const [line] = buildStatementLines(
      [INV({ due_date: "2020-01-01", status: "paid" })],
      TODAY,
    );
    expect(line.status).toBe("paid");
  });

  // The oldest unpaid invoice is what the conversation is actually about.
  it("sorts oldest first", () => {
    const lines = buildStatementLines(
      [
        INV({ issue_date: "2026-07-01", invoice_number: "B" }),
        INV({ issue_date: "2026-05-01", invoice_number: "A" }),
        INV({ issue_date: "2026-08-01", invoice_number: "C" }),
      ],
      TODAY,
    );
    expect(lines.map((l) => l.invoiceNumber)).toEqual(["A", "B", "C"]);
  });

  it("falls back to the creation day for a row with no issue date", () => {
    const [line] = buildStatementLines(
      [INV({ issue_date: null, created_at: "2026-06-11T08:00:00Z" })],
      TODAY,
    );
    expect(line.issuedOn).toBe("2026-06-11");
  });
});

describe("statementTotals", () => {
  it("adds up billed, paid and owing across the lines", () => {
    const lines = buildStatementLines(
      [
        INV({ amount_cents: 100_00, amount_paid_cents: 40_00 }),
        INV({ amount_cents: 250_00, status: "paid" }),
        INV({ amount_cents: 50_00 }),
      ],
      TODAY,
    );
    expect(statementTotals(lines)).toEqual({
      totalBilledCents: 400_00,
      totalPaidCents: 290_00,
      totalOwingCents: 110_00,
    });
  });

  it("is all zeroes for an empty statement", () => {
    expect(statementTotals([])).toEqual({
      totalBilledCents: 0,
      totalPaidCents: 0,
      totalOwingCents: 0,
    });
  });
});

describe("statementPeriodLabel", () => {
  it("describes a full range, an open start, an open end, and neither", () => {
    const en = { language: "en" as const };
    expect(
      statementPeriodLabel({ ...en, from: "2026-01-01", to: "2026-03-31" }),
    ).toBe("January 1, 2026 to March 31, 2026");
    expect(statementPeriodLabel({ ...en, from: "2026-01-01", to: null })).toBe(
      "From January 1, 2026",
    );
    expect(statementPeriodLabel({ ...en, from: null, to: "2026-03-31" })).toBe(
      "Up to March 31, 2026",
    );
    expect(statementPeriodLabel({ ...en, from: null, to: null })).toBe(
      "All invoices to date",
    );
  });

  it("speaks French when the client does", () => {
    expect(
      statementPeriodLabel({ language: "fr", from: null, to: null }),
    ).toBe("Toutes les factures à ce jour");
  });
});

describe("statementFilename", () => {
  const MODEL = (over: Partial<StatementModel> = {}): StatementModel =>
    ({
      language: "en",
      clientName: "Acme Corp.",
      generatedOn: "2026-08-03",
      ...over,
    }) as StatementModel;

  it("names the file after the client and the day", () => {
    expect(statementFilename(MODEL())).toBe(
      "statement-Acme-Corp-2026-08-03.pdf",
    );
  });

  it("uses the French stem for a French client", () => {
    expect(statementFilename(MODEL({ language: "fr" }))).toBe(
      "etat-de-compte-Acme-Corp-2026-08-03.pdf",
    );
  });

  // Accented names are normal here and must survive; a name that is entirely
  // punctuation must not produce a filename that is just dashes.
  it("keeps accents and survives a punctuation-only name", () => {
    expect(statementFilename(MODEL({ clientName: "Légumes Frères" }))).toBe(
      "statement-Légumes-Frères-2026-08-03.pdf",
    );
    expect(statementFilename(MODEL({ clientName: "***" }))).toBe(
      "statement-client-2026-08-03.pdf",
    );
  });
});

import { describe, it, expect } from "vitest";
import {
  amountPaidCents,
  outstandingCents,
  isOverdue,
  invoiceDisplayStatus,
  isChaseable,
  type InvoiceStateInput,
} from "./outstanding";

const INV = (over: Partial<InvoiceStateInput> = {}): InvoiceStateInput => ({
  status: "requested",
  amount_cents: 100_00,
  amount_paid_cents: 0,
  due_date: null,
  ...over,
});

// The day everything below is judged against. Fixed so a test run in August
// and a test run in January agree.
const TODAY = new Date("2026-08-03T12:00:00Z");

describe("outstandingCents", () => {
  it("is the full amount on an untouched invoice", () => {
    expect(outstandingCents(INV())).toBe(100_00);
  });

  it("subtracts a partial payment", () => {
    expect(outstandingCents(INV({ amount_paid_cents: 40_00 }))).toBe(60_00);
  });

  // The whole reason this module exists: every invoice settled before the
  // payment ledger shipped has status paid and amount_paid_cents = 0. Reading
  // it as arithmetic would report the firm's entire payment history as owed.
  it("is zero for a PAID invoice that has no ledger rows (pre-1270)", () => {
    expect(outstandingCents(INV({ status: "paid", amount_paid_cents: 0 }))).toBe(
      0,
    );
  });

  it("is zero for a void invoice regardless of what was paid", () => {
    expect(
      outstandingCents(INV({ status: "canceled", amount_paid_cents: 0 })),
    ).toBe(0);
  });

  it("is still owed after a failed card attempt", () => {
    expect(outstandingCents(INV({ status: "failed" }))).toBe(100_00);
  });

  it("never goes negative when a client over-pays", () => {
    expect(outstandingCents(INV({ amount_paid_cents: 150_00 }))).toBe(0);
  });

  it("treats a missing amount_paid_cents (pre-migration read) as nothing paid", () => {
    expect(outstandingCents(INV({ amount_paid_cents: undefined }))).toBe(100_00);
    expect(amountPaidCents(INV({ amount_paid_cents: null }))).toBe(0);
  });
});

describe("isOverdue", () => {
  it("is false with no due date", () => {
    expect(isOverdue(INV(), TODAY)).toBe(false);
  });

  it("is false ON the due date — the client has all day", () => {
    expect(isOverdue(INV({ due_date: "2026-08-03" }), TODAY)).toBe(false);
  });

  it("is true the day after", () => {
    expect(isOverdue(INV({ due_date: "2026-08-02" }), TODAY)).toBe(true);
  });

  it("is false once paid, however late the due date", () => {
    expect(
      isOverdue(INV({ due_date: "2020-01-01", status: "paid" }), TODAY),
    ).toBe(false);
  });

  it("is false once fully covered by partial payments", () => {
    expect(
      isOverdue(
        INV({ due_date: "2020-01-01", amount_paid_cents: 100_00 }),
        TODAY,
      ),
    ).toBe(false);
  });

  // A late-evening due date in Vancouver must not read as overdue because UTC
  // has already rolled over. Comparing ISO day strings keeps that impossible.
  it("compares whole days, not instants", () => {
    const lateUtc = new Date("2026-08-03T23:59:59Z");
    expect(isOverdue(INV({ due_date: "2026-08-03" }), lateUtc)).toBe(false);
  });
});

describe("invoiceDisplayStatus", () => {
  it("maps the stored statuses", () => {
    expect(invoiceDisplayStatus(INV(), TODAY)).toBe("unpaid");
    expect(invoiceDisplayStatus(INV({ status: "paid" }), TODAY)).toBe("paid");
    expect(invoiceDisplayStatus(INV({ status: "canceled" }), TODAY)).toBe(
      "void",
    );
    expect(invoiceDisplayStatus(INV({ status: "failed" }), TODAY)).toBe(
      "failed",
    );
  });

  it("reports partly paid when some money has landed", () => {
    expect(
      invoiceDisplayStatus(INV({ amount_paid_cents: 25_00 }), TODAY),
    ).toBe("partly_paid");
  });

  it("prefers overdue over partly paid — it is the more actionable one", () => {
    expect(
      invoiceDisplayStatus(
        INV({ amount_paid_cents: 25_00, due_date: "2026-07-01" }),
        TODAY,
      ),
    ).toBe("overdue");
  });

  it("prefers overdue over failed for the same reason", () => {
    expect(
      invoiceDisplayStatus(
        INV({ status: "failed", due_date: "2026-07-01" }),
        TODAY,
      ),
    ).toBe("overdue");
  });

  it("never calls a void invoice overdue", () => {
    expect(
      invoiceDisplayStatus(
        INV({ status: "canceled", due_date: "2020-01-01" }),
        TODAY,
      ),
    ).toBe("void");
  });
});

describe("isChaseable", () => {
  it("chases an unpaid invoice by default", () => {
    expect(isChaseable(INV())).toBe(true);
  });

  it("stops the moment the toggle goes off", () => {
    expect(isChaseable({ ...INV(), auto_chase: false })).toBe(false);
  });

  it("stops on payment and on void", () => {
    expect(isChaseable({ ...INV({ status: "paid" }), auto_chase: true })).toBe(
      false,
    );
    expect(
      isChaseable({ ...INV({ status: "canceled" }), auto_chase: true }),
    ).toBe(false);
  });

  it("stops once partial payments cover the whole bill", () => {
    expect(
      isChaseable({ ...INV({ amount_paid_cents: 100_00 }), auto_chase: true }),
    ).toBe(false);
  });

  it("keeps chasing a partly paid invoice that still owes", () => {
    expect(
      isChaseable({ ...INV({ amount_paid_cents: 60_00 }), auto_chase: true }),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  acceptanceActivatesImmediately,
  invoiceAfterDeposit,
  isAwaitingDeposit,
} from "./activation";

const facts = (over: Partial<Parameters<typeof acceptanceActivatesImmediately>[0]> = {}) => ({
  depositCents: null,
  canCollectPayment: true,
  depositPaid: false,
  ...over,
});

describe("acceptanceActivatesImmediately", () => {
  it("starts work at once when there is no deposit — the ordinary case", () => {
    expect(acceptanceActivatesImmediately(facts())).toBe(true);
    expect(acceptanceActivatesImmediately(facts({ depositCents: 0 }))).toBe(true);
  });

  it("waits for the money when a deposit is due and can be collected", () => {
    expect(
      acceptanceActivatesImmediately(facts({ depositCents: 100_000 })),
    ).toBe(false);
  });

  it("does NOT wait when the firm cannot take a payment", () => {
    // A deposit nobody can pay must not hold the portal shut — that would trap
    // the client in a state with no way out and no way to pay.
    expect(
      acceptanceActivatesImmediately(
        facts({ depositCents: 100_000, canCollectPayment: false }),
      ),
    ).toBe(true);
  });

  it("starts work once the deposit is settled", () => {
    expect(
      acceptanceActivatesImmediately(
        facts({ depositCents: 100_000, depositPaid: true }),
      ),
    ).toBe(true);
  });

  it("treats a settled deposit as settled even if rails later break", () => {
    expect(
      acceptanceActivatesImmediately(
        facts({ depositCents: 100_000, depositPaid: true, canCollectPayment: false }),
      ),
    ).toBe(true);
  });
});

describe("isAwaitingDeposit", () => {
  it("is false before anyone has agreed, whatever the deposit says", () => {
    // Asking for money before agreement is the wrong order, and the founder
    // corrected exactly that ordering once already.
    expect(
      isAwaitingDeposit({ ...facts({ depositCents: 100_000 }), acceptedAt: null }),
    ).toBe(false);
    expect(
      isAwaitingDeposit({
        ...facts({ depositCents: 100_000 }),
        acceptedAt: undefined,
      }),
    ).toBe(false);
  });

  it("is true once accepted with an unpaid, collectable deposit", () => {
    expect(
      isAwaitingDeposit({
        ...facts({ depositCents: 100_000 }),
        acceptedAt: "2026-08-06T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("is false once the deposit is paid", () => {
    expect(
      isAwaitingDeposit({
        ...facts({ depositCents: 100_000, depositPaid: true }),
        acceptedAt: "2026-08-06T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("is false for an accepted engagement with no deposit", () => {
    expect(
      isAwaitingDeposit({ ...facts(), acceptedAt: "2026-08-06T00:00:00Z" }),
    ).toBe(false);
  });
});

describe("invoiceAfterDeposit", () => {
  it("bills the BALANCE — the founder's answer, verbatim", () => {
    // "$5,000 engagement, $1,000 deposit -> the balance obviously."
    expect(invoiceAfterDeposit(500_000, 100_000)).toBe(400_000);
  });

  it("bills the full amount when no deposit was paid", () => {
    expect(invoiceAfterDeposit(500_000, 0)).toBe(500_000);
    expect(invoiceAfterDeposit(500_000, -1)).toBe(500_000);
  });

  it("never returns negative money", () => {
    // A deposit bigger than the total (a typo, or a scope that shrank) must not
    // produce an invoice for minus money — no rail can charge it.
    expect(invoiceAfterDeposit(100_000, 500_000)).toBe(0);
    expect(invoiceAfterDeposit(100_000, 100_000)).toBe(0);
  });

  it("returns 0 for a non-invoice rather than propagating nonsense", () => {
    expect(invoiceAfterDeposit(0, 100_000)).toBe(0);
    expect(invoiceAfterDeposit(-5, 0)).toBe(0);
    expect(invoiceAfterDeposit(Number.NaN, 100)).toBe(0);
  });

  it("keeps everything in whole cents", () => {
    expect(invoiceAfterDeposit(500_000, 33_333.4)).toBe(466_667);
  });
});

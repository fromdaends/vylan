import { describe, expect, it } from "vitest";
import {
  acceptanceActivatesImmediately,
  invoiceAfterDeposit,
  isAwaitingPayment,
} from "./activation";

const facts = (
  over: Partial<Parameters<typeof acceptanceActivatesImmediately>[0]> = {},
) => ({
  dueNowCents: null as number | null,
  canCollectPayment: true,
  ...over,
});

describe("acceptanceActivatesImmediately", () => {
  it("starts work at once when nothing is owed — the ordinary case", () => {
    expect(acceptanceActivatesImmediately(facts())).toBe(true);
    expect(acceptanceActivatesImmediately(facts({ dueNowCents: 0 }))).toBe(true);
  });

  it("holds the portal when money is owed and can be collected", () => {
    expect(acceptanceActivatesImmediately(facts({ dueNowCents: 100_000 }))).toBe(
      false,
    );
  });

  it("is agnostic about WHICH money — it only asks whether any is due", () => {
    // This function does not know what a deposit is, deliberately. Its caller
    // (deposit-state.ts) decides what counts as due-now, and today that is the
    // unpaid DEPOSIT only, per the founder: "its simply for the deposit that
    // you must pay right away."
    //
    // Keeping the rule agnostic is what let that policy change be a one-line
    // filter in the reader rather than a rewrite here.
    expect(acceptanceActivatesImmediately(facts({ dueNowCents: 45_990 }))).toBe(
      false,
    );
  });

  it("does NOT hold when the firm cannot take a payment", () => {
    // Money nobody can pay must not hold the portal shut — that would trap the
    // client in a state with no way out and no way to pay.
    expect(
      acceptanceActivatesImmediately(
        facts({ dueNowCents: 100_000, canCollectPayment: false }),
      ),
    ).toBe(true);
  });

  it("starts work once the outstanding balance reaches zero", () => {
    // A paid invoice leaves `status = 'requested'`, so it stops being counted —
    // which is how paying opens the portal.
    expect(acceptanceActivatesImmediately(facts({ dueNowCents: null }))).toBe(
      true,
    );
  });
});

describe("isAwaitingPayment", () => {
  it("is false before anyone has agreed, whatever is owed", () => {
    // Asking for money before agreement is the wrong order, and the founder
    // corrected exactly that ordering once already.
    expect(
      isAwaitingPayment({
        ...facts({ dueNowCents: 100_000 }),
        acceptedAt: null,
      }),
    ).toBe(false);
    expect(
      isAwaitingPayment({
        ...facts({ dueNowCents: 100_000 }),
        acceptedAt: undefined,
      }),
    ).toBe(false);
  });

  it("is true once accepted with a collectable balance outstanding", () => {
    expect(
      isAwaitingPayment({
        ...facts({ dueNowCents: 100_000 }),
        acceptedAt: "2026-08-06T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("is false once the balance is settled", () => {
    expect(
      isAwaitingPayment({
        ...facts({ dueNowCents: null }),
        acceptedAt: "2026-08-06T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("is false for an accepted engagement that owes nothing", () => {
    expect(
      isAwaitingPayment({ ...facts(), acceptedAt: "2026-08-06T00:00:00Z" }),
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

describe("ONLY a deposit gates the portal", () => {
  // The founder's rule, verbatim: "if theres a deposit its paid right away. If
  // it isnt, the actual contract amount can be payed through the client portal
  // at any time. Its simply for the deposit that you must pay right away."
  //
  // These read as duplicates of the cases above, and that is the point: the
  // RULE is unchanged, but what feeds `dueNowCents` narrowed from "every
  // outstanding invoice" to "the unpaid deposit". The reader is what enforces
  // it (deposit-state.ts filters kind='deposit'), so these pin the contract
  // between the two: whatever is passed in gates, and nothing else is passed in.

  it("holds the portal for an unpaid deposit", () => {
    expect(acceptanceActivatesImmediately(facts({ dueNowCents: 100_000 }))).toBe(
      false,
    );
  });

  it("lets the client in when the deposit is settled, even mid-contract", () => {
    // A $4,000 contract balance may still be outstanding here. It is theirs to
    // pay whenever they like, and it must not keep them out of their own portal.
    expect(acceptanceActivatesImmediately(facts({ dueNowCents: null }))).toBe(
      true,
    );
  });

  it("lets the client straight in when there is no deposit at all", () => {
    // The commonest case, and the one my widened gate broke: an engagement
    // billed on acceptance with no deposit locked the client out entirely.
    expect(
      isAwaitingPayment({ ...facts(), acceptedAt: "2026-08-06T00:00:00Z" }),
    ).toBe(false);
  });
});

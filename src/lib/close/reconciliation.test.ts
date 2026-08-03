import { describe, it, expect } from "vitest";
import {
  reconcileAccount,
  summarizeReconciliation,
  isFullyReconciled,
  type ReconAccount,
} from "./reconciliation";

const account = (over: Partial<ReconAccount> = {}): ReconAccount => ({
  accountId: "a1",
  name: "Chequing",
  kind: "bank",
  bookBalanceCents: 100_00,
  statementBalanceCents: 100_00,
  ...over,
});

describe("reconcileAccount", () => {
  it("reconciles only when both numbers are known AND equal", () => {
    expect(reconcileAccount(account())).toEqual({ kind: "reconciled" });
  });

  it("reports the signed difference — books minus statement", () => {
    // Books say more than the bank does: something is recorded that never
    // cleared.
    expect(
      reconcileAccount(
        account({ bookBalanceCents: 340_15, statementBalanceCents: 100_00 }),
      ),
    ).toEqual({ kind: "off", differenceCents: 240_15 });
    // And the other way round.
    expect(
      reconcileAccount(
        account({ bookBalanceCents: 100_00, statementBalanceCents: 340_15 }),
      ),
    ).toEqual({ kind: "off", differenceCents: -240_15 });
  });

  it("NEVER calls it reconciled when the statement balance was never entered", () => {
    const status = reconcileAccount(account({ statementBalanceCents: null }));
    expect(status).toEqual({ kind: "unknown", missing: "statement" });
  });

  it("NEVER calls it reconciled when the books could not be read", () => {
    expect(reconcileAccount(account({ bookBalanceCents: null }))).toEqual({
      kind: "unknown",
      missing: "books",
    });
  });

  it("a zero book balance is a real number, not a missing one", () => {
    // The trap: 0 is falsy. An empty account whose statement also says 0 IS
    // reconciled, and must not be mistaken for "we could not read it".
    expect(
      reconcileAccount(
        account({ bookBalanceCents: 0, statementBalanceCents: 0 }),
      ),
    ).toEqual({ kind: "reconciled" });
    expect(
      reconcileAccount(
        account({ bookBalanceCents: 0, statementBalanceCents: 50_00 }),
      ),
    ).toEqual({ kind: "off", differenceCents: -50_00 });
  });

  it("handles negative balances — a credit card owes money", () => {
    expect(
      reconcileAccount(
        account({
          kind: "credit_card",
          bookBalanceCents: -1_240_00,
          statementBalanceCents: -1_240_00,
        }),
      ),
    ).toEqual({ kind: "reconciled" });
  });

  it("says which half is missing when neither is known", () => {
    expect(
      reconcileAccount(
        account({ bookBalanceCents: null, statementBalanceCents: null }),
      ),
    ).toEqual({ kind: "unknown", missing: "both" });
  });
});

describe("summarizeReconciliation", () => {
  it("counts each bucket and surfaces the biggest discrepancy", () => {
    const summary = summarizeReconciliation([
      account({ accountId: "1" }),
      account({ accountId: "2", bookBalanceCents: 500_00, statementBalanceCents: 400_00 }),
      account({ accountId: "3", bookBalanceCents: 100_00, statementBalanceCents: 900_00 }),
      account({ accountId: "4", statementBalanceCents: null }),
    ]);
    expect(summary).toEqual({
      total: 4,
      reconciled: 1,
      off: 2,
      unknown: 1,
      // -800_00 is larger in absolute terms than +100_00.
      largestDifferenceCents: -800_00,
    });
  });

  it("is empty-safe", () => {
    expect(summarizeReconciliation([])).toEqual({
      total: 0,
      reconciled: 0,
      off: 0,
      unknown: 0,
      largestDifferenceCents: null,
    });
  });
});

describe("isFullyReconciled", () => {
  it("is true only when every account reconciled", () => {
    expect(
      isFullyReconciled(
        summarizeReconciliation([account({ accountId: "1" }), account({ accountId: "2" })]),
      ),
    ).toBe(true);
    expect(
      isFullyReconciled(
        summarizeReconciliation([
          account({ accountId: "1" }),
          account({ accountId: "2", statementBalanceCents: null }),
        ]),
      ),
    ).toBe(false);
  });

  it("NO accounts is not 'all done' — the failure that would bless an unreconciled month", () => {
    expect(isFullyReconciled(summarizeReconciliation([]))).toBe(false);
  });
});

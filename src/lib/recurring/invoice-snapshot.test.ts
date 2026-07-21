import { describe, expect, it } from "vitest";
import {
  deriveInvoiceSnapshotFromEngagement,
  parseInvoiceSnapshot,
} from "./invoice-snapshot";

describe("parseInvoiceSnapshot", () => {
  it("accepts a valid at_spawn snapshot and normalizes the description", () => {
    expect(
      parseInvoiceSnapshot({
        timing: "at_spawn",
        delay_days: null,
        amount_cents: 45_000,
        locks_deliverables: true,
        description: "  Monthly bookkeeping  ",
      }),
    ).toEqual({
      timing: "at_spawn",
      delay_days: null,
      amount_cents: 45_000,
      locks_deliverables: true,
      description: "Monthly bookkeeping",
    });
  });

  it("rejects garbage, bad timings, and out-of-range amounts", () => {
    expect(parseInvoiceSnapshot(null)).toBeNull();
    expect(parseInvoiceSnapshot("nope")).toBeNull();
    expect(
      parseInvoiceSnapshot({ timing: "weekly", amount_cents: 45_000 }),
    ).toBeNull();
    expect(
      parseInvoiceSnapshot({ timing: "at_spawn", amount_cents: 49 }),
    ).toBeNull();
    expect(
      parseInvoiceSnapshot({ timing: "at_spawn", amount_cents: 100_000_000 }),
    ).toBeNull();
    expect(
      parseInvoiceSnapshot({ timing: "at_spawn", amount_cents: 45.5 }),
    ).toBeNull();
  });

  it("requires a usable delay for 'delayed' and drops it otherwise", () => {
    expect(
      parseInvoiceSnapshot({
        timing: "delayed",
        delay_days: null,
        amount_cents: 45_000,
      }),
    ).toBeNull();
    expect(
      parseInvoiceSnapshot({
        timing: "delayed",
        delay_days: 7,
        amount_cents: 45_000,
      }),
    ).toMatchObject({ timing: "delayed", delay_days: 7 });
    // Non-delayed timings never carry a delay.
    expect(
      parseInvoiceSnapshot({
        timing: "on_completion",
        delay_days: 7,
        amount_cents: 45_000,
      }),
    ).toMatchObject({ timing: "on_completion", delay_days: null });
  });
});

describe("deriveInvoiceSnapshotFromEngagement", () => {
  const bare = {
    invoice_auto_mode: "off" as const,
    invoice_delay_days: null,
    invoice_amount_cents: null,
    invoice_locks_deliverables: false,
    invoice_description: null,
  };

  it("prefers configured automation over an existing invoice row", () => {
    const snap = deriveInvoiceSnapshotFromEngagement(
      {
        ...bare,
        invoice_auto_mode: "delayed",
        invoice_delay_days: 7,
        invoice_amount_cents: 45_000,
        invoice_locks_deliverables: true,
        invoice_description: "Bookkeeping",
      },
      {
        status: "requested",
        amount_cents: 99_00,
        locks_deliverables: false,
        description: "ignored",
      },
    );
    expect(snap).toEqual({
      timing: "delayed",
      delay_days: 7,
      amount_cents: 45_000,
      locks_deliverables: true,
      description: "Bookkeeping",
    });
  });

  it("falls back to a live invoice row as at_spawn", () => {
    expect(
      deriveInvoiceSnapshotFromEngagement(bare, {
        status: "requested",
        amount_cents: 45_000,
        locks_deliverables: true,
        description: "March books",
      }),
    ).toEqual({
      timing: "at_spawn",
      delay_days: null,
      amount_cents: 45_000,
      locks_deliverables: true,
      description: "March books",
    });
  });

  it("ignores canceled invoices and returns null with nothing to copy", () => {
    expect(
      deriveInvoiceSnapshotFromEngagement(bare, {
        status: "canceled",
        amount_cents: 45_000,
        locks_deliverables: false,
        description: null,
      }),
    ).toBeNull();
    expect(deriveInvoiceSnapshotFromEngagement(bare, null)).toBeNull();
  });
});

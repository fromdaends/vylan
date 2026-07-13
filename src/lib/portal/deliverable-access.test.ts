import { describe, it, expect } from "vitest";
import {
  isDeliverablesLocked,
  isDeliverableDownloadAllowed,
  type DeliverableLockState,
} from "./deliverable-access";

const ENG = { id: "e1", status: "in_progress", magic_expires_at: null };
const DELIVERABLE = { engagement_id: "e1" };

describe("isDeliverablesLocked", () => {
  it("is unlocked when there is no invoice / no lock state", () => {
    expect(isDeliverablesLocked(null)).toBe(false);
  });

  it("is unlocked when the invoice does not lock deliverables", () => {
    const lock: DeliverableLockState = {
      locksDeliverables: false,
      invoiceStatus: "requested",
      overrideUnlocked: false,
    };
    expect(isDeliverablesLocked(lock)).toBe(false);
  });

  it("is LOCKED when it locks deliverables and the invoice is unpaid", () => {
    expect(
      isDeliverablesLocked({
        locksDeliverables: true,
        invoiceStatus: "requested",
        overrideUnlocked: false,
      }),
    ).toBe(true);
    expect(
      isDeliverablesLocked({
        locksDeliverables: true,
        invoiceStatus: "failed",
        overrideUnlocked: false,
      }),
    ).toBe(true);
  });

  it("unlocks once paid", () => {
    expect(
      isDeliverablesLocked({
        locksDeliverables: true,
        invoiceStatus: "paid",
        overrideUnlocked: false,
      }),
    ).toBe(false);
  });

  it("unlocks when the invoice is canceled/waived", () => {
    expect(
      isDeliverablesLocked({
        locksDeliverables: true,
        invoiceStatus: "canceled",
        overrideUnlocked: false,
      }),
    ).toBe(false);
  });

  it("unlocks on the accountant's manual override even while unpaid", () => {
    expect(
      isDeliverablesLocked({
        locksDeliverables: true,
        invoiceStatus: "requested",
        overrideUnlocked: true,
      }),
    ).toBe(false);
  });
});

describe("isDeliverableDownloadAllowed", () => {
  it("allows a valid token + matching engagement + owned deliverable (no lock)", () => {
    expect(
      isDeliverableDownloadAllowed({
        tokenShapeValid: true,
        engagement: ENG,
        deliverable: DELIVERABLE,
      }),
    ).toBe(true);
  });

  it("denies a malformed token", () => {
    expect(
      isDeliverableDownloadAllowed({
        tokenShapeValid: false,
        engagement: ENG,
        deliverable: DELIVERABLE,
      }),
    ).toBe(false);
  });

  it("denies when the token resolves to no engagement", () => {
    expect(
      isDeliverableDownloadAllowed({
        tokenShapeValid: true,
        engagement: null,
        deliverable: DELIVERABLE,
      }),
    ).toBe(false);
  });

  it("denies a cancelled engagement", () => {
    expect(
      isDeliverableDownloadAllowed({
        tokenShapeValid: true,
        engagement: { ...ENG, status: "cancelled" },
        deliverable: DELIVERABLE,
      }),
    ).toBe(false);
  });

  it("denies an expired magic link", () => {
    expect(
      isDeliverableDownloadAllowed({
        tokenShapeValid: true,
        engagement: {
          ...ENG,
          magic_expires_at: "2000-01-01T00:00:00.000Z",
        },
        deliverable: DELIVERABLE,
        now: new Date("2020-01-01T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("denies a deliverable that belongs to another engagement (no cross-token access)", () => {
    expect(
      isDeliverableDownloadAllowed({
        tokenShapeValid: true,
        engagement: ENG,
        deliverable: { engagement_id: "OTHER" },
      }),
    ).toBe(false);
  });

  it("denies a missing deliverable id", () => {
    expect(
      isDeliverableDownloadAllowed({
        tokenShapeValid: true,
        engagement: ENG,
        deliverable: null,
      }),
    ).toBe(false);
  });

  it("denies an otherwise-valid request when the deliverables are locked (unpaid)", () => {
    expect(
      isDeliverableDownloadAllowed({
        tokenShapeValid: true,
        engagement: ENG,
        deliverable: DELIVERABLE,
        lock: {
          locksDeliverables: true,
          invoiceStatus: "requested",
          overrideUnlocked: false,
        },
      }),
    ).toBe(false);
  });

  it("allows when locked-flag set but invoice paid", () => {
    expect(
      isDeliverableDownloadAllowed({
        tokenShapeValid: true,
        engagement: ENG,
        deliverable: DELIVERABLE,
        lock: {
          locksDeliverables: true,
          invoiceStatus: "paid",
          overrideUnlocked: false,
        },
      }),
    ).toBe(true);
  });
});

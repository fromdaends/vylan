import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const getCurrentFirm = vi.fn();
const getLatestPaymentRequestForEngagement = vi.fn();
const setPaymentRequestOverrideUnlocked = vi.fn();
const cancelPaymentRequest = vi.fn();
const logUserActivity = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/db/users", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/db/firms", () => ({ getCurrentFirm: () => getCurrentFirm() }));
vi.mock("@/lib/db/payment-requests", () => ({
  getLatestPaymentRequestForEngagement: (id: string) =>
    getLatestPaymentRequestForEngagement(id),
  setPaymentRequestOverrideUnlocked: (id: string) =>
    setPaymentRequestOverrideUnlocked(id),
  cancelPaymentRequest: (id: string) => cancelPaymentRequest(id),
}));
vi.mock("@/lib/db/activity", () => ({
  logUserActivity: (...args: unknown[]) => logUserActivity(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

import { unlockDeliverablesAction, waiveInvoiceAction } from "./invoices";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const ENG_ID = "22222222-2222-2222-2222-222222222222";

function fd(engagementId: string | null) {
  const f = new FormData();
  if (engagementId !== null) f.set("engagement_id", engagementId);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1", firm_id: FIRM_ID });
  getCurrentFirm.mockResolvedValue({ id: FIRM_ID });
  getLatestPaymentRequestForEngagement.mockResolvedValue({
    id: "pr1",
    status: "requested",
  });
  setPaymentRequestOverrideUnlocked.mockResolvedValue(true);
  cancelPaymentRequest.mockResolvedValue(true);
});

describe("unlockDeliverablesAction", () => {
  it("overrides the lock + logs activity on a live invoice", async () => {
    await unlockDeliverablesAction(fd(ENG_ID));
    expect(setPaymentRequestOverrideUnlocked).toHaveBeenCalledWith("pr1");
    expect(logUserActivity).toHaveBeenCalledWith(
      FIRM_ID,
      ENG_ID,
      "invoice_unlocked",
      expect.objectContaining({ payment_request_id: "pr1" }),
    );
    expect(revalidatePath).toHaveBeenCalled();
  });

  it("is a no-op when the invoice is already paid", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue({
      id: "pr1",
      status: "paid",
    });
    await unlockDeliverablesAction(fd(ENG_ID));
    expect(setPaymentRequestOverrideUnlocked).not.toHaveBeenCalled();
    expect(logUserActivity).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no invoice", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue(null);
    await unlockDeliverablesAction(fd(ENG_ID));
    expect(setPaymentRequestOverrideUnlocked).not.toHaveBeenCalled();
  });

  it("ignores a missing/invalid engagement id", async () => {
    await unlockDeliverablesAction(fd(null));
    expect(getLatestPaymentRequestForEngagement).not.toHaveBeenCalled();
  });
});

describe("waiveInvoiceAction", () => {
  it("cancels the invoice + logs activity on a live invoice", async () => {
    await waiveInvoiceAction(fd(ENG_ID));
    expect(cancelPaymentRequest).toHaveBeenCalledWith("pr1");
    expect(logUserActivity).toHaveBeenCalledWith(
      FIRM_ID,
      ENG_ID,
      "invoice_waived",
      expect.objectContaining({ payment_request_id: "pr1" }),
    );
  });

  it("is a no-op on an already-cancelled invoice", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue({
      id: "pr1",
      status: "canceled",
    });
    await waiveInvoiceAction(fd(ENG_ID));
    expect(cancelPaymentRequest).not.toHaveBeenCalled();
  });

  it("returns without acting when unauthenticated", async () => {
    getCurrentFirm.mockResolvedValue(null);
    await waiveInvoiceAction(fd(ENG_ID));
    expect(getLatestPaymentRequestForEngagement).not.toHaveBeenCalled();
    expect(cancelPaymentRequest).not.toHaveBeenCalled();
  });
});

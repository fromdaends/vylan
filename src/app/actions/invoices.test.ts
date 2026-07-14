import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
const getCurrentFirm = vi.fn();
const getEngagement = vi.fn();
const setEngagementInvoiceLock = vi.fn();
const updateEngagementInvoiceAutomation = vi.fn();
const getLatestPaymentRequestForEngagement = vi.fn();
const setPaymentRequestOverrideUnlocked = vi.fn();
const relockPaymentRequestDeliverables = vi.fn();
const updatePaymentRequestAmountDescription = vi.fn();
const cancelPaymentRequest = vi.fn();
const logUserActivity = vi.fn();
const revalidatePath = vi.fn();
const cancelScheduledInvoice = vi.fn();
const dispatchInvoiceOnCompletion = vi.fn();

vi.mock("@/lib/db/users", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/db/firms", () => ({ getCurrentFirm: () => getCurrentFirm() }));
vi.mock("@/lib/db/engagements", () => ({
  getEngagement: (id: string) => getEngagement(id),
  setEngagementInvoiceLock: (id: string, v: boolean) =>
    setEngagementInvoiceLock(id, v),
  updateEngagementInvoiceAutomation: (...args: unknown[]) =>
    updateEngagementInvoiceAutomation(...args),
}));
vi.mock("@/lib/db/payment-requests", () => ({
  getLatestPaymentRequestForEngagement: (id: string) =>
    getLatestPaymentRequestForEngagement(id),
  setPaymentRequestOverrideUnlocked: (id: string) =>
    setPaymentRequestOverrideUnlocked(id),
  relockPaymentRequestDeliverables: (id: string) =>
    relockPaymentRequestDeliverables(id),
  updatePaymentRequestAmountDescription: (
    id: string,
    cents: number,
    desc: string | null,
  ) => updatePaymentRequestAmountDescription(id, cents, desc),
  cancelPaymentRequest: (id: string) => cancelPaymentRequest(id),
}));
vi.mock("@/lib/db/activity", () => ({
  logUserActivity: (...args: unknown[]) => logUserActivity(...args),
}));
vi.mock("@/lib/invoices/schedule", () => ({
  cancelScheduledInvoice: (...args: unknown[]) =>
    cancelScheduledInvoice(...args),
  dispatchInvoiceOnCompletion: (...args: unknown[]) =>
    dispatchInvoiceOnCompletion(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

import {
  unlockDeliverablesAction,
  relockDeliverablesAction,
  waiveInvoiceAction,
  editInvoiceAction,
  updateInvoiceAutomationAction,
} from "./invoices";

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
  relockPaymentRequestDeliverables.mockResolvedValue(true);
  updatePaymentRequestAmountDescription.mockResolvedValue(true);
  cancelPaymentRequest.mockResolvedValue(true);
  getEngagement.mockResolvedValue({
    id: ENG_ID,
    firm_id: FIRM_ID,
    invoice_locks_deliverables: false,
  });
  setEngagementInvoiceLock.mockResolvedValue(true);
  updateEngagementInvoiceAutomation.mockResolvedValue(true);
  cancelScheduledInvoice.mockResolvedValue(1);
  dispatchInvoiceOnCompletion.mockResolvedValue(undefined);
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

  it("is a no-op when there is no invoice and the engagement doesn't lock", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue(null);
    await unlockDeliverablesAction(fd(ENG_ID));
    expect(setPaymentRequestOverrideUnlocked).not.toHaveBeenCalled();
    expect(setEngagementInvoiceLock).not.toHaveBeenCalled();
  });

  it("clears the engagement lock preference when finals are fallback-locked with no invoice row (override always available)", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue(null);
    getEngagement.mockResolvedValue({
      id: ENG_ID,
      firm_id: FIRM_ID,
      invoice_locks_deliverables: true,
    });
    await unlockDeliverablesAction(fd(ENG_ID));
    expect(setPaymentRequestOverrideUnlocked).not.toHaveBeenCalled();
    expect(setEngagementInvoiceLock).toHaveBeenCalledWith(ENG_ID, false);
    expect(logUserActivity).toHaveBeenCalledWith(
      FIRM_ID,
      ENG_ID,
      "invoice_unlocked",
      expect.anything(),
    );
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

describe("relockDeliverablesAction", () => {
  it("re-locks a live invoice + re-sets the engagement preference", async () => {
    await relockDeliverablesAction(fd(ENG_ID));
    expect(relockPaymentRequestDeliverables).toHaveBeenCalledWith("pr1");
    expect(setEngagementInvoiceLock).toHaveBeenCalledWith(ENG_ID, true);
    expect(logUserActivity).toHaveBeenCalledWith(
      FIRM_ID,
      ENG_ID,
      "invoice_relocked",
      expect.anything(),
    );
  });

  it("does not re-lock a paid invoice", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue({
      id: "pr1",
      status: "paid",
    });
    await relockDeliverablesAction(fd(ENG_ID));
    expect(relockPaymentRequestDeliverables).not.toHaveBeenCalled();
    expect(setEngagementInvoiceLock).not.toHaveBeenCalled();
  });

  it("re-locks via the engagement fallback when no invoice row exists", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue(null);
    await relockDeliverablesAction(fd(ENG_ID));
    expect(relockPaymentRequestDeliverables).not.toHaveBeenCalled();
    expect(setEngagementInvoiceLock).toHaveBeenCalledWith(ENG_ID, true);
  });
});

describe("editInvoiceAction", () => {
  it("updates amount + trimmed description on a live invoice", async () => {
    const res = await editInvoiceAction({
      engagementId: ENG_ID,
      amountCents: 25000,
      description: "  2025 return  ",
    });
    expect(res).toEqual({ ok: true });
    expect(updatePaymentRequestAmountDescription).toHaveBeenCalledWith(
      "pr1",
      25000,
      "2025 return",
    );
  });

  it("rejects an amount below the Stripe minimum", async () => {
    const res = await editInvoiceAction({
      engagementId: ENG_ID,
      amountCents: 10,
    });
    expect(res).toEqual({ ok: false, error: "amount" });
    expect(updatePaymentRequestAmountDescription).not.toHaveBeenCalled();
  });

  it("refuses when there is no live invoice (paid/none)", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue({
      id: "pr1",
      status: "paid",
    });
    const res = await editInvoiceAction({
      engagementId: ENG_ID,
      amountCents: 25000,
    });
    expect(res).toEqual({ ok: false, error: "no_invoice" });
  });
});

describe("updateInvoiceAutomationAction", () => {
  function automationForm(mode: "off" | "on_completion" | "delayed") {
    const form = fd(ENG_ID);
    form.set("mode", mode);
    form.set("delay_days", "5");
    form.set("amount_cents", "25000");
    form.set("description", "  2026 return  ");
    form.set("locks_deliverables", "true");
    return form;
  }

  it("saves and reschedules automation on a completed engagement", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue(null);
    getEngagement.mockResolvedValue({
      id: ENG_ID,
      firm_id: FIRM_ID,
      status: "complete",
      completed_at: "2026-07-10T14:00:00.000Z",
    });

    const result = await updateInvoiceAutomationAction(
      automationForm("delayed"),
    );

    expect(result).toEqual({ ok: true });
    expect(updateEngagementInvoiceAutomation).toHaveBeenCalledWith(ENG_ID, {
      mode: "delayed",
      delayDays: 5,
      amountCents: 25000,
      description: "2026 return",
      locksDeliverables: true,
    });
    expect(cancelScheduledInvoice).toHaveBeenCalledWith(ENG_ID);
    expect(dispatchInvoiceOnCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        id: ENG_ID,
        invoice_auto_mode: "delayed",
        invoice_delay_days: 5,
      }),
    );
  });

  it("does not change automation after an invoice exists", async () => {
    const result = await updateInvoiceAutomationAction(
      automationForm("on_completion"),
    );

    expect(result).toEqual({ ok: false, error: "already_invoiced" });
    expect(updateEngagementInvoiceAutomation).not.toHaveBeenCalled();
    expect(cancelScheduledInvoice).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate the helper from the supabase/next-headers chain by mocking the data
// modules it depends on.
const getCurrentUser = vi.fn();
const getCurrentFirm = vi.fn();
const getEngagement = vi.fn();
const getClient = vi.fn();
const createPaymentRequest = vi.fn();
const getLatestPaymentRequestForEngagement = vi.fn();
const logUserActivity = vi.fn();
const sendEmail = vi.fn();

vi.mock("@/lib/db/users", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/db/firms", () => ({ getCurrentFirm: () => getCurrentFirm() }));
vi.mock("@/lib/db/engagements", () => ({
  getEngagement: (id: string) => getEngagement(id),
}));
vi.mock("@/lib/db/clients", () => ({ getClient: (id: string) => getClient(id) }));
vi.mock("@/lib/db/payment-requests", () => ({
  createPaymentRequest: (input: unknown) => createPaymentRequest(input),
  getLatestPaymentRequestForEngagement: (id: string) =>
    getLatestPaymentRequestForEngagement(id),
}));
vi.mock("@/lib/db/activity", () => ({
  logUserActivity: (...args: unknown[]) => logUserActivity(...args),
}));
vi.mock("@/lib/email", () => ({
  buildPaymentRequestEmail: () => ({ subject: "s", html: "h", text: "t" }),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));
vi.mock("@/lib/storage", () => ({
  getBrandingImageUrlForEmail: async () => null,
}));

import { createInvoiceForEngagement } from "./create";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const ENG_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1", firm_id: FIRM_ID });
  getCurrentFirm.mockResolvedValue({
    id: FIRM_ID,
    name: "Acme",
    logo_url: null,
    connect_charges_enabled: true,
  });
  getEngagement.mockResolvedValue({
    id: ENG_ID,
    firm_id: FIRM_ID,
    client_id: "c1",
    title: "2025 return",
    magic_token: "tok_test",
  });
  getClient.mockResolvedValue({
    email: "client@example.com",
    display_name: "Client",
    locale: "en",
  });
  createPaymentRequest.mockResolvedValue({ id: "pr1" });
  getLatestPaymentRequestForEngagement.mockResolvedValue(null);
  sendEmail.mockResolvedValue({ sent: true, id: "e1" });
});

describe("createInvoiceForEngagement", () => {
  it("creates the invoice + logs activity + emails on the happy path", async () => {
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 35000,
      description: "  2025 tax return  ",
      delivery: "both",
      locksDeliverables: true,
    });
    expect(res).toEqual({ ok: true, id: "pr1" });
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        firm_id: FIRM_ID,
        engagement_id: ENG_ID,
        client_id: "c1",
        amount_cents: 35000,
        currency: "cad",
        // trimmed
        description: "2025 tax return",
        delivery: "both",
        requested_by_user_id: "u1",
        locks_deliverables: true,
      }),
    );
    expect(logUserActivity).toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "client@example.com" }),
    );
  });

  it("does not email a draft engagement (no portal token yet)", async () => {
    getEngagement.mockResolvedValue({
      id: ENG_ID,
      firm_id: FIRM_ID,
      client_id: "c1",
      title: "2025 return",
      magic_token: null,
    });
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res.ok).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses when the firm has not connected Stripe", async () => {
    getCurrentFirm.mockResolvedValue({
      id: FIRM_ID,
      connect_charges_enabled: false,
    });
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res).toEqual({ ok: false, reason: "not_connected" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("rejects an amount below the Stripe minimum", async () => {
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 10,
      delivery: "portal",
    });
    expect(res).toEqual({ ok: false, reason: "invalid_amount" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("refuses an engagement that belongs to another firm", async () => {
    getEngagement.mockResolvedValue({
      id: ENG_ID,
      firm_id: "99999999-9999-9999-9999-999999999999",
      client_id: "c1",
    });
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res).toEqual({ ok: false, reason: "not_found" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("refuses a second live invoice (one per engagement)", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue({
      id: "pr0",
      status: "requested",
    });
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res).toEqual({ ok: false, reason: "already_invoiced" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("defaults locks_deliverables to false when not requested", async () => {
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "portal",
    });
    expect(res.ok).toBe(true);
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ locks_deliverables: false }),
    );
  });
});

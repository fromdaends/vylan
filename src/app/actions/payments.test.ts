import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate the action from the supabase/next-headers chain by mocking the data
// modules it depends on.
const getCurrentUser = vi.fn();
const getCurrentFirm = vi.fn();
const getEngagement = vi.fn();
const createPaymentRequest = vi.fn();
const logUserActivity = vi.fn();
const getClient = vi.fn();
const sendEmail = vi.fn();

vi.mock("@/lib/db/users", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/db/firms", () => ({ getCurrentFirm: () => getCurrentFirm() }));
vi.mock("@/lib/db/engagements", () => ({
  getEngagement: (id: string) => getEngagement(id),
}));
vi.mock("@/lib/db/clients", () => ({ getClient: (id: string) => getClient(id) }));
vi.mock("@/lib/db/payment-requests", () => ({
  createPaymentRequest: (input: unknown) => createPaymentRequest(input),
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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { requestPaymentAction } from "./payments";

const FIRM_ID = "11111111-1111-1111-1111-111111111111";
const ENG_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "u1", role: "owner", firm_id: FIRM_ID });
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
  sendEmail.mockResolvedValue({ sent: true, id: "e1" });
});

describe("requestPaymentAction", () => {
  it("creates a payment request + logs activity on the happy path", async () => {
    const res = await requestPaymentAction({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res).toEqual({ ok: true, id: "pr1" });
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        firm_id: FIRM_ID,
        engagement_id: ENG_ID,
        client_id: "c1",
        amount_cents: 35000,
        currency: "cad",
        delivery: "both",
        requested_by_user_id: "u1",
      }),
    );
    expect(logUserActivity).toHaveBeenCalledWith(
      FIRM_ID,
      ENG_ID,
      "payment_requested",
      expect.objectContaining({ amount_cents: 35000, currency: "cad" }),
    );
    // delivery "both" emails the client a pay link.
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "client@example.com" }),
    );
  });

  it("does not email the client when delivery is portal-only", async () => {
    const res = await requestPaymentAction({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "portal",
    });
    expect(res.ok).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("refuses when the firm has not connected Stripe", async () => {
    getCurrentFirm.mockResolvedValue({
      id: FIRM_ID,
      connect_charges_enabled: false,
    });
    const res = await requestPaymentAction({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res).toEqual({ ok: false, error: "not_connected" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("rejects an amount below the Stripe minimum", async () => {
    const res = await requestPaymentAction({
      engagementId: ENG_ID,
      amountCents: 10,
      delivery: "portal",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("amount_too_small");
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("refuses an engagement that belongs to another firm", async () => {
    getEngagement.mockResolvedValue({
      id: ENG_ID,
      firm_id: "99999999-9999-9999-9999-999999999999",
      client_id: "c1",
    });
    const res = await requestPaymentAction({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res).toEqual({ ok: false, error: "not_found" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("returns unauthenticated when there is no firm", async () => {
    getCurrentFirm.mockResolvedValue(null);
    const res = await requestPaymentAction({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res).toEqual({ ok: false, error: "unauthenticated" });
  });
});

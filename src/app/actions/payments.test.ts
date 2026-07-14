import { describe, it, expect, vi, beforeEach } from "vitest";

// Isolate the action from the supabase/next-headers chain by mocking the data
// modules it depends on.
const getCurrentUser = vi.fn();
const getCurrentFirm = vi.fn();
const getEngagement = vi.fn();
const createPaymentRequest = vi.fn();
const getLatestPaymentRequestForEngagement = vi.fn();
const logUserActivity = vi.fn();
const getClient = vi.fn();
const sendEmail = vi.fn();
const uploadObject = vi.fn();
const removeObjectQuiet = vi.fn();
const createFinalDocument = vi.fn();
const deleteFinalDocument = vi.fn();

vi.mock("@/lib/db/users", () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock("@/lib/db/firms", () => ({ getCurrentFirm: () => getCurrentFirm() }));
vi.mock("@/lib/db/engagements", () => ({
  getEngagement: (id: string) => getEngagement(id),
}));
vi.mock("@/lib/db/clients", () => ({ getClient: (id: string) => getClient(id) }));
vi.mock("@/lib/db/final-documents", () => ({
  createFinalDocument: (input: unknown) => createFinalDocument(input),
  deleteFinalDocument: (id: string) => deleteFinalDocument(id),
}));
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
  invoiceAttachmentPath: () => "firms/f1/engagements/e1/invoices/invoice.pdf",
  isAllowedMime: (mime: string) => mime === "application/pdf",
  MAX_BYTES: 25 * 1024 * 1024,
  removeObjectQuiet: (...args: unknown[]) => removeObjectQuiet(...args),
  truncateFilename: (name: string) => name,
  uploadObject: (...args: unknown[]) => uploadObject(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  requestPaymentAction,
  requestPaymentWithAttachmentAction,
} from "./payments";

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
  getLatestPaymentRequestForEngagement.mockResolvedValue(null);
  sendEmail.mockResolvedValue({ sent: true, id: "e1" });
  uploadObject.mockResolvedValue(undefined);
  removeObjectQuiet.mockResolvedValue(undefined);
  createFinalDocument.mockResolvedValue({ id: "fd-invoice" });
  deleteFinalDocument.mockResolvedValue({ storage_path: "invoice.pdf" });
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

  it("refuses a second invoice when a live one already exists (one per engagement)", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue({
      id: "pr0",
      status: "requested",
    });
    const res = await requestPaymentAction({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res).toEqual({ ok: false, error: "already_invoiced" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("allows a new invoice after the previous one was cancelled", async () => {
    getLatestPaymentRequestForEngagement.mockResolvedValue({
      id: "pr0",
      status: "canceled",
    });
    const res = await requestPaymentAction({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res).toEqual({ ok: true, id: "pr1" });
    expect(createPaymentRequest).toHaveBeenCalled();
  });

  it("passes the deliverables lock through to the invoice", async () => {
    const res = await requestPaymentAction({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
      locksDeliverables: true,
    });
    expect(res.ok).toBe(true);
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ locks_deliverables: true }),
    );
  });

  it("uploads and emails an attached invoice document", async () => {
    const formData = new FormData();
    formData.set("engagement_id", ENG_ID);
    formData.set("amount_cents", "35000");
    formData.set("description", "Tax return invoice");
    formData.set("locks_deliverables", "false");
    formData.set(
      "attachment",
      new File(["invoice"], "Invoice-2026.pdf", {
        type: "application/pdf",
      }),
    );

    const result = await requestPaymentWithAttachmentAction(formData);

    expect(result).toEqual({ ok: true, id: "pr1" });
    expect(uploadObject).toHaveBeenCalled();
    expect(createFinalDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        engagement_id: ENG_ID,
        original_filename: "Invoice-2026.pdf",
        mime_type: "application/pdf",
      }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ filename: "Invoice-2026.pdf" }),
        ],
      }),
    );
  });
});

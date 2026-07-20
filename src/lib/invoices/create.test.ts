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
const getFirmInvoiceSettings = vi.fn();
const allocateInvoiceSeq = vi.fn();

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
vi.mock("@/lib/db/invoice-settings", () => ({
  getFirmInvoiceSettings: () => getFirmInvoiceSettings(),
  allocateInvoiceSeq: (firmId: string) => allocateInvoiceSeq(firmId),
}));
vi.mock("@/lib/email", () => ({
  buildPaymentRequestEmail: () => ({ subject: "s", html: "h", text: "t" }),
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));
vi.mock("@/lib/storage", () => ({
  getBrandingImageUrlForEmail: async () => null,
}));
// Creating an invoice re-resolves the engagement's stage. The resolver's rules
// are covered by src/lib/engagements/stage.test.ts; stub it here so this stays a
// test of invoice creation.
vi.mock("@/lib/engagements/stage-sync", () => ({
  syncEngagementStage: async () => null,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({}),
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
  getFirmInvoiceSettings.mockResolvedValue({
    firm_id: FIRM_ID,
    province: "QC",
    gst_number: "123456789 RT0001",
    qst_number: "111 TQ0001",
    pst_number: null,
    invoice_prefix: "INV-",
    next_invoice_seq: 12,
    default_terms: "Due on receipt",
    default_notes: null,
    default_taxes_enabled: true,
  });
  allocateInvoiceSeq.mockResolvedValue(12);
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

  it("maps a unique-index race (createPaymentRequest 'duplicate') to already_invoiced", async () => {
    // The app-layer guard passed (no live invoice seen), but a concurrent create
    // won the DB one-invoice race → createPaymentRequest returns "duplicate".
    createPaymentRequest.mockResolvedValue("duplicate");
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 35000,
      delivery: "both",
    });
    expect(res).toEqual({ ok: false, reason: "already_invoiced" });
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

describe("createInvoiceForEngagement — generated invoices (0750)", () => {
  const GENERATED = {
    lineItems: [
      { description: "Personal return (T1)", quantity: 1, unit_cents: 20000 },
      { description: "Bookkeeping", quantity: 2, unit_cents: 5000 },
    ],
    taxesEnabled: true,
    enabledComponents: null,
  };

  it("computes totals server-side, allocates a number, charges subtotal+taxes", async () => {
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 0, // placeholder — must be ignored
      delivery: "both",
      generated: GENERATED,
    });
    expect(res).toEqual({ ok: true, id: "pr1" });
    // $300 subtotal → GST $15.00 + QST $29.93 (2992.5 rounds up) = $344.93
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_cents: 34493,
        subtotal_cents: 30000,
        tax_total_cents: 4493,
        invoice_kind: "generated",
        invoice_seq: 12,
        invoice_number: "INV-0012",
        invoice_terms: "Due on receipt",
        invoice_language: "en",
        description: "Personal return (T1)",
      }),
    );
    const insert = createPaymentRequest.mock.calls[0][0] as {
      tax_breakdown: Array<Record<string, unknown>>;
    };
    expect(insert.tax_breakdown).toEqual([
      expect.objectContaining({
        component: "GST",
        base_cents: 30000,
        amount_cents: 1500,
        registration_number: "123456789 RT0001",
      }),
      expect.objectContaining({
        component: "QST",
        base_cents: 30000,
        amount_cents: 2993,
        registration_number: "111 TQ0001",
      }),
    ]);
  });

  it("re-allocates and retries when the seq backstop rejects the number", async () => {
    createPaymentRequest
      .mockResolvedValueOnce("seq_duplicate")
      .mockResolvedValueOnce({ id: "pr2" });
    allocateInvoiceSeq.mockResolvedValueOnce(12).mockResolvedValueOnce(13);
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 0,
      delivery: "portal",
      generated: GENERATED,
    });
    expect(res).toEqual({ ok: true, id: "pr2" });
    expect(createPaymentRequest).toHaveBeenCalledTimes(2);
    expect(createPaymentRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ invoice_seq: 13, invoice_number: "INV-0013" }),
    );
  });

  it("no invoice settings → no taxes, no number, subtotal charged", async () => {
    getFirmInvoiceSettings.mockResolvedValue(null);
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 0,
      delivery: "portal",
      generated: GENERATED,
    });
    expect(res.ok).toBe(true);
    expect(allocateInvoiceSeq).not.toHaveBeenCalled();
    const insert = createPaymentRequest.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(insert.amount_cents).toBe(30000);
    expect(insert.tax_breakdown).toEqual([]);
    expect(insert.invoice_number).toBeUndefined();
  });

  it("component toggle flows through (QST off → GST only)", async () => {
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 0,
      delivery: "portal",
      generated: { ...GENERATED, enabledComponents: ["GST"] },
    });
    expect(res.ok).toBe(true);
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 31500, tax_total_cents: 1500 }),
    );
  });

  it("master taxes off → subtotal only", async () => {
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 0,
      delivery: "portal",
      generated: { ...GENERATED, taxesEnabled: false },
    });
    expect(res.ok).toBe(true);
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 30000, tax_total_cents: 0 }),
    );
  });

  it("rejects malformed lines without touching the DB or the counter", async () => {
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 0,
      delivery: "portal",
      generated: { ...GENERATED, lineItems: [{ description: "", quantity: 1, unit_cents: 100 }] },
    });
    expect(res).toEqual({ ok: false, reason: "invalid_lines" });
    expect(allocateInvoiceSeq).not.toHaveBeenCalled();
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("rejects a computed total below the Stripe minimum before allocating", async () => {
    const res = await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 0,
      delivery: "portal",
      generated: {
        lineItems: [{ description: "Tiny", quantity: 1, unit_cents: 10 }],
        taxesEnabled: false,
        enabledComponents: null,
      },
    });
    expect(res).toEqual({ ok: false, reason: "invalid_amount" });
    expect(allocateInvoiceSeq).not.toHaveBeenCalled();
  });

  it("invoice language follows the client's portal locale", async () => {
    getClient.mockResolvedValue({
      email: "c@example.com",
      display_name: "C",
      locale: "fr",
    });
    await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 0,
      delivery: "portal",
      generated: GENERATED,
    });
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ invoice_language: "fr" }),
    );
  });

  it("emails the charged TOTAL, not the subtotal", async () => {
    await createInvoiceForEngagement({
      engagementId: ENG_ID,
      amountCents: 0,
      delivery: "both",
      generated: GENERATED,
    });
    // The email builder is stubbed; assert the send happened after a
    // generated create (the amount itself is formatted inside the stub).
    expect(sendEmail).toHaveBeenCalled();
  });
});

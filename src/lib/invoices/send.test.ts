import { beforeEach, describe, expect, it, vi } from "vitest";

const sendEmail = vi.fn();
const downloadObject = vi.fn();
const getInvoiceAttachment = vi.fn();
const createPaymentRequest = vi.fn();
const getLatestPaymentRequest = vi.fn();
const insertActivity = vi.fn();

const engagement = {
  id: "e1",
  firm_id: "f1",
  client_id: "c1",
  title: "2026 return",
  status: "complete",
  magic_token: "token-1",
  invoice_amount_cents: 25_000,
};

const serviceRole = {
  from(table: string) {
    return {
      select(columns: string) {
        return {
          eq() {
            return {
              async maybeSingle() {
                if (table === "engagements") {
                  if (columns === "status") return { data: { status: "complete" } };
                  if (columns.includes("invoice_locks_deliverables")) {
                    return {
                      data: {
                        invoice_locks_deliverables: false,
                        invoice_description: "Tax services",
                      },
                    };
                  }
                  return { data: engagement };
                }
                if (table === "firms") {
                  return {
                    data: {
                      name: "Acme",
                      logo_url: null,
                      connect_charges_enabled: true,
                    },
                  };
                }
                if (table === "clients") {
                  return {
                    data: {
                      display_name: "Jordan",
                      email: "jordan@example.com",
                      locale: "en",
                    },
                  };
                }
                return { data: null };
              },
            };
          },
        };
      },
      insert(input: unknown) {
        insertActivity(input);
        return Promise.resolve({ error: null });
      },
    };
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => serviceRole,
}));
vi.mock("@/lib/db/payment-requests", () => ({
  createPaymentRequestSR: (input: unknown) => createPaymentRequest(input),
  getLatestPaymentRequestForEngagementSR: (id: string) =>
    getLatestPaymentRequest(id),
}));
const getFirmInvoiceSettingsSR = vi.fn();
const allocateInvoiceSeqSR = vi.fn();
vi.mock("@/lib/db/invoice-settings", () => ({
  getFirmInvoiceSettingsSR: (firmId: string) => getFirmInvoiceSettingsSR(firmId),
  allocateInvoiceSeqSR: (firmId: string) => allocateInvoiceSeqSR(firmId),
}));
vi.mock("@/lib/email", () => ({
  buildPaymentRequestEmail: () => ({ subject: "Invoice", html: "h", text: "t" }),
  sendEmail: (input: unknown) => sendEmail(input),
}));
vi.mock("@/lib/storage", () => ({
  downloadObject: (path: string) => downloadObject(path),
  getBrandingImageUrlForEmail: async () => null,
}));
vi.mock("@/lib/db/final-documents", () => ({
  getInvoiceAttachmentForEngagementSR: (id: string) =>
    getInvoiceAttachment(id),
}));

import { sendEngagementInvoice } from "./send";

beforeEach(() => {
  vi.clearAllMocks();
  getLatestPaymentRequest.mockResolvedValue(null);
  createPaymentRequest.mockResolvedValue({ id: "pay-1" });
  getInvoiceAttachment.mockResolvedValue({
    original_filename: "Invoice-2026.pdf",
    storage_path: "firms/f1/engagements/e1/invoices/invoice.pdf",
  });
  downloadObject.mockResolvedValue(Buffer.from("invoice"));
  sendEmail.mockResolvedValue({ sent: true, id: "email-1" });
  // Default: the firm has NOT set up Invoicing — the automation behaves
  // exactly as before 0750 (flat amount, no taxes, no number).
  getFirmInvoiceSettingsSR.mockResolvedValue(null);
  allocateInvoiceSeqSR.mockResolvedValue(null);
});

const QC_SETTINGS = {
  firm_id: "f1",
  province: "QC",
  gst_number: "123456789 RT0001",
  qst_number: "111 TQ0001",
  pst_number: null,
  invoice_prefix: "INV-",
  next_invoice_seq: 7,
  default_terms: "Due on receipt",
  default_notes: null,
  default_taxes_enabled: true,
};

describe("sendEngagementInvoice", () => {
  it("attaches the stored invoice document to an automated invoice email", async () => {
    const result = await sendEngagementInvoice("e1");

    expect(result).toEqual({
      ok: true,
      paymentRequestId: "pay-1",
      emailSent: true,
    });
    expect(downloadObject).toHaveBeenCalledWith(
      "firms/f1/engagements/e1/invoices/invoice.pdf",
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "jordan@example.com",
        attachments: [
          expect.objectContaining({ filename: "Invoice-2026.pdf" }),
        ],
      }),
    );
  });

  it("no invoice settings → the flat pre-0750 insert, byte-identical", async () => {
    const result = await sendEngagementInvoice("e1");
    expect(result.ok).toBe(true);
    const input = createPaymentRequest.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(input.amount_cents).toBe(25_000);
    expect(input.invoice_kind).toBeUndefined();
    expect(input.line_items).toBeUndefined();
    expect(input.invoice_number).toBeUndefined();
    expect(allocateInvoiceSeqSR).not.toHaveBeenCalled();
  });

  it("with Invoicing set up: single-line GENERATED invoice, default taxes on top, numbered", async () => {
    getFirmInvoiceSettingsSR.mockResolvedValue(QC_SETTINGS);
    allocateInvoiceSeqSR.mockResolvedValue(7);
    const result = await sendEngagementInvoice("e1");
    expect(result.ok).toBe(true);
    // $250.00 + GST $12.50 + QST $24.94 (2493.75 → 2494) = $287.44
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_cents: 28_744,
        subtotal_cents: 25_000,
        tax_total_cents: 3_744,
        invoice_kind: "generated",
        invoice_seq: 7,
        invoice_number: "INV-0007",
        invoice_terms: "Due on receipt",
        invoice_language: "en",
      }),
    );
    const input = createPaymentRequest.mock.calls[0][0] as {
      line_items: Array<Record<string, unknown>>;
      tax_breakdown: Array<Record<string, unknown>>;
    };
    expect(input.line_items).toEqual([
      {
        description: "Tax services",
        quantity: 1,
        unit_cents: 25_000,
        amount_cents: 25_000,
      },
    ]);
    expect(input.tax_breakdown).toEqual([
      expect.objectContaining({
        component: "GST",
        amount_cents: 1250,
        registration_number: "123456789 RT0001",
      }),
      expect.objectContaining({
        component: "QST",
        amount_cents: 2494,
        registration_number: "111 TQ0001",
      }),
    ]);
  });

  it("settings with default taxes OFF: generated + numbered, but no tax lines", async () => {
    getFirmInvoiceSettingsSR.mockResolvedValue({
      ...QC_SETTINGS,
      default_taxes_enabled: false,
    });
    allocateInvoiceSeqSR.mockResolvedValue(8);
    await sendEngagementInvoice("e1");
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_cents: 25_000,
        tax_total_cents: 0,
        invoice_kind: "generated",
        invoice_number: "INV-0008",
      }),
    );
  });

  it("re-allocates and retries when the seq backstop rejects the number", async () => {
    getFirmInvoiceSettingsSR.mockResolvedValue(QC_SETTINGS);
    allocateInvoiceSeqSR.mockResolvedValueOnce(7).mockResolvedValueOnce(9);
    createPaymentRequest
      .mockResolvedValueOnce("seq_duplicate")
      .mockResolvedValueOnce({ id: "pay-2" });
    const result = await sendEngagementInvoice("e1");
    expect(result.ok).toBe(true);
    expect(createPaymentRequest).toHaveBeenCalledTimes(2);
    expect(createPaymentRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ invoice_seq: 9, invoice_number: "INV-0009" }),
    );
  });

  it("a concurrent auto-send ('duplicate') still reads as already sent", async () => {
    getFirmInvoiceSettingsSR.mockResolvedValue(QC_SETTINGS);
    allocateInvoiceSeqSR.mockResolvedValue(7);
    createPaymentRequest.mockResolvedValue("duplicate");
    const result = await sendEngagementInvoice("e1");
    expect(result).toEqual({ ok: false, reason: "already_sent" });
  });
});

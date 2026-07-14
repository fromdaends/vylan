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
});

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
});

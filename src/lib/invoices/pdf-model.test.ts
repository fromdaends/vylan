import { describe, it, expect } from "vitest";
import {
  buildInvoicePdfModel,
  lineDescriptionForDisplay,
  pdfDate,
  pdfMoney,
  pdfQuantity,
  invoicePdfFilename,
  generatedInvoicePdfPath,
} from "./pdf-model";
import type { PaymentRequest } from "@/lib/db/payment-requests";

const REQUEST: PaymentRequest = {
  id: "pr1",
  firm_id: "f1",
  engagement_id: "e1",
  client_id: "c1",
  amount_cents: 34493,
  currency: "cad",
  description: "T1",
  status: "requested",
  delivery: "both",
  stripe_checkout_session_id: null,
  stripe_payment_intent_id: null,
  paid_at: null,
  requested_by_user_id: "u1",
  created_at: "2026-07-20T01:00:00Z",
  invoice_kind: "generated",
  line_items: [
    { description: "T1", quantity: 1, unit_cents: 20000, amount_cents: 20000 },
    { description: "", quantity: 2, unit_cents: 5000, amount_cents: 10000 },
  ],
  tax_breakdown: [
    {
      component: "GST",
      rate_milli_pct: 5000,
      registration_kind: "gst",
      base_cents: 30000,
      amount_cents: 1500,
      registration_number: "123456789 RT0001",
    },
    {
      component: "QST",
      rate_milli_pct: 9975,
      registration_kind: "qst",
      base_cents: 30000,
      amount_cents: 2993,
      registration_number: null,
    },
  ],
  subtotal_cents: 30000,
  tax_total_cents: 4493,
  invoice_seq: 12,
  invoice_number: "INV-0012",
  issue_date: "2026-07-20",
  due_date: "2026-08-04",
  invoice_terms: "Due on receipt",
  invoice_notes: null,
  invoice_language: "fr",
};

describe("buildInvoicePdfModel", () => {
  it("assembles the full model from the stored row", () => {
    const model = buildInvoicePdfModel({
      request: REQUEST,
      firm: { name: "Cabinet Untel", brand_color: "#2563eb" },
      settings: {
        address: "123 rue Principale\nMontréal (Québec) H2X 1Y4",
        contact_line: "info@untel.ca",
      },
      clientName: "Luna Arcuri",
      engagementTitle: "Impôts 2025",
      logoDataUri: null,
    });
    expect(model.language).toBe("fr");
    expect(model.firmAddressLines).toEqual([
      "123 rue Principale",
      "Montréal (Québec) H2X 1Y4",
    ]);
    expect(model.brandColor).toBe("#2563eb");
    expect(model.invoiceNumber).toBe("INV-0012");
    expect(model.lines).toHaveLength(2);
    expect(model.taxLines).toHaveLength(2);
    expect(model.subtotalCents).toBe(30000);
    expect(model.totalCents).toBe(34493);
    expect(model.paid).toBe(false);
  });

  it("defaults language to fr only when stored as fr, en when en", () => {
    const en = buildInvoicePdfModel({
      request: { ...REQUEST, invoice_language: "en" },
      firm: { name: "F", brand_color: null },
      settings: null,
      clientName: null,
      engagementTitle: null,
      logoDataUri: null,
    });
    expect(en.language).toBe("en");
  });

  it("rejects an invalid brand color (falls back to ink)", () => {
    const model = buildInvoicePdfModel({
      request: REQUEST,
      firm: { name: "F", brand_color: "red; injection" },
      settings: null,
      clientName: null,
      engagementTitle: null,
      logoDataUri: null,
    });
    expect(model.brandColor).toBe("#0f172a");
  });

  it("falls back to created_at for a missing issue date and marks paid rows", () => {
    const model = buildInvoicePdfModel({
      request: { ...REQUEST, issue_date: null, status: "paid" },
      firm: { name: "F", brand_color: null },
      settings: null,
      clientName: null,
      engagementTitle: null,
      logoDataUri: null,
    });
    expect(model.issueDate).toBe("2026-07-20");
    expect(model.paid).toBe(true);
  });
});

describe("formatting", () => {
  it("localizes money", () => {
    expect(pdfMoney(34493, "en")).toBe("$344.93");
    // fr-CA: non-breaking spaces group thousands, symbol trails.
    expect(pdfMoney(123456789, "fr").replace(/ | /g, " ")).toBe(
      "1 234 567,89 $",
    );
  });

  it("localizes dates without timezone drift", () => {
    expect(pdfDate("2026-07-20", "en")).toBe("July 20, 2026");
    expect(pdfDate("2026-07-20", "fr")).toBe("20 juillet 2026");
  });

  it("localizes quantities", () => {
    expect(pdfQuantity(2, "en")).toBe("2");
    expect(pdfQuantity(2.5, "fr")).toBe("2,5");
  });

  it("shows a localized fallback for an empty description", () => {
    expect(lineDescriptionForDisplay("", "en")).toBe("Professional services");
    expect(lineDescriptionForDisplay("", "fr")).toBe("Services professionnels");
    expect(lineDescriptionForDisplay("Real", "fr")).toBe("Real");
  });

  it("names the file after the invoice number", () => {
    const model = buildInvoicePdfModel({
      request: REQUEST,
      firm: { name: "F", brand_color: null },
      settings: null,
      clientName: null,
      engagementTitle: null,
      logoDataUri: null,
    });
    expect(invoicePdfFilename(model)).toBe("INV-0012.pdf");
    expect(
      invoicePdfFilename({ ...model, invoiceNumber: null }),
    ).toBe("facture.pdf");
  });

  it("builds the frozen-copy storage path under the firm prefix", () => {
    expect(
      generatedInvoicePdfPath({
        firmId: "f1",
        engagementId: "e1",
        paymentRequestId: "pr-9",
      }),
    ).toBe("firms/f1/engagements/e1/invoices/generated-pr-9.pdf");
  });
});

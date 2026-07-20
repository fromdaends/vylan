// @vitest-environment node
// (renderToBuffer needs real Node streams, not happy-dom's.)
import { describe, it, expect } from "vitest";
import { renderInvoicePdf } from "./pdf";
import type { InvoicePdfModel } from "./pdf-model";

const MODEL: InvoicePdfModel = {
  language: "fr",
  firmName: "Cabinet Untel CPA",
  firmAddressLines: ["123 rue Principale", "Montréal (Québec) H2X 1Y4"],
  firmContactLine: "facturation@untel.ca · 514-555-0123",
  brandColor: "#2563eb",
  logoDataUri: null,
  clientName: "Luna Arcuri",
  engagementTitle: "Impôts personnels 2025",
  invoiceNumber: "INV-0012",
  issueDate: "2026-07-20",
  dueDate: "2026-08-04",
  lines: [
    { description: "Déclaration T1", quantity: 1, unit_cents: 20000, amount_cents: 20000 },
    { description: "", quantity: 2.5, unit_cents: 4000, amount_cents: 10000 },
  ],
  taxLines: [
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
      registration_number: "1234567890 TQ0001",
    },
  ],
  subtotalCents: 30000,
  taxTotalCents: 4493,
  totalCents: 34493,
  terms: "Payable à réception",
  notes: "Merci de votre confiance.",
  paid: false,
};

describe("renderInvoicePdf", () => {
  it("renders a real PDF (magic bytes + non-trivial size), FR with accents", async () => {
    const buf = await renderInvoicePdf(MODEL);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(2000);
  });

  it("renders EN, paid, no settings, no number (minimal model)", async () => {
    const buf = await renderInvoicePdf({
      ...MODEL,
      language: "en",
      firmAddressLines: [],
      firmContactLine: null,
      invoiceNumber: null,
      taxLines: [],
      taxTotalCents: 0,
      totalCents: 30000,
      terms: null,
      notes: null,
      paid: true,
    });
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

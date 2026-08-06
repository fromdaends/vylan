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
  // What the proposal said was due on acceptance (1680). A different number
  // from the fee on purpose: reading the wrong column would invoice the whole
  // engagement the moment somebody signed.
  deposit_cents: 10_000 as number | null,
};

// Rows the deposit-credit read (paidDepositCentsSR) should find. Empty by
// default, so every existing assertion below still describes an invoice with no
// deposit credited — which is what those tests set up. The deposit-credit test
// fills it.
let paidDepositRows: Array<{ amount_cents: number | null }> = [];

// The engagement's priced one-time service lines. Empty by default, so every
// existing assertion still describes the pre-1740 single-flat-line invoice —
// which is exactly the fallback those tests were written against.
let serviceLineRows: Array<Record<string, unknown>> = [];

const serviceRole = {
  from(table: string) {
    return {
      select(columns: string) {
        // A CHAINABLE builder. The deposit-credit read filters on three columns
        // (engagement_id, kind, status) and awaits the builder directly for a
        // LIST; every other read here filters once and calls maybeSingle. One
        // object serves both: eq() returns itself, and `then` makes it
        // awaitable.
        const builder = {
          eq: () => builder,
          // The invoice now reads the engagement's one-time service lines, which
          // orders them — so the stub has to be orderable as well as filterable.
          order: () => builder,
          then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
            return Promise.resolve({
              data:
                table === "payment_requests"
                  ? paidDepositRows
                  : table === "engagement_items"
                    ? serviceLineRows
                    : [],
              error: null,
            }).then(resolve);
          },
          async maybeSingle() {
            if (table === "engagements") {
              // Mirror the mock row so tests can flip its status (the
              // at-spawn cases exercise 'sent' occurrences).
              if (columns === "status")
                return { data: { status: engagement.status } };
              if (columns === "deposit_cents") {
                return { data: { deposit_cents: engagement.deposit_cents } };
              }
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
        return builder;
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
  // The idempotency question is asked PER KIND now (1680): a deposit and the
  // final invoice are two charges on one job. These tests all exercise the
  // engagement invoice, so the kind-scoped lookup answers from the same stub.
  getPaymentRequestForEngagementKindSR: (id: string) =>
    getLatestPaymentRequest(id),
}));
const getFirmInvoiceSettingsSR = vi.fn();
const allocateInvoiceSeqSR = vi.fn();
vi.mock("@/lib/db/invoice-settings", () => ({
  getFirmInvoiceSettingsSR: (firmId: string) =>
    getFirmInvoiceSettingsSR(firmId),
  allocateInvoiceSeqSR: (firmId: string) => allocateInvoiceSeqSR(firmId),
}));
vi.mock("@/lib/email", () => ({
  buildPaymentRequestEmail: () => ({
    subject: "Invoice",
    html: "h",
    text: "t",
  }),
  sendEmail: (input: unknown) => sendEmail(input),
}));
vi.mock("@/lib/storage", () => ({
  downloadObject: (path: string) => downloadObject(path),
  getBrandingImageUrlForEmail: async () => null,
}));
vi.mock("@/lib/db/final-documents", () => ({
  getInvoiceAttachmentForEngagementSR: (id: string) => getInvoiceAttachment(id),
}));

import { sendEngagementInvoice } from "./send";

beforeEach(() => {
  vi.clearAllMocks();
  engagement.status = "complete";
  // Reset the module-level stub rows HERE, not per-describe. They are `let`s
  // shared by every test in the file, so a block that sets them silently
  // changed the answer for every block after it — which is exactly what
  // happened: an acceptance test read a $4,000 service line left behind by the
  // itemisation tests and asserted against the wrong number.
  paidDepositRows = [];
  serviceLineRows = [];
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

  // At-spawn invoicing (recurring occurrences, Phase 4): the ONLY divergence
  // from the completion path is the status gate — a fresh spawn is 'sent'.
  describe("atSpawn mode", () => {
    it("invoices a live 'sent' occurrence", async () => {
      engagement.status = "sent";
      const result = await sendEngagementInvoice("e1", { atSpawn: true });
      expect(result).toEqual({
        ok: true,
        paymentRequestId: "pay-1",
        emailSent: true,
      });
      expect(createPaymentRequest).toHaveBeenCalledWith(
        expect.objectContaining({ amount_cents: 25_000 }),
      );
    });

    it("the default (completion) path still refuses a 'sent' engagement", async () => {
      engagement.status = "sent";
      const result = await sendEngagementInvoice("e1");
      expect(result).toEqual({ ok: false, reason: "not_complete" });
      expect(createPaymentRequest).not.toHaveBeenCalled();
    });

    it("atSpawn refuses a completed or cancelled engagement", async () => {
      engagement.status = "complete";
      expect(await sendEngagementInvoice("e1", { atSpawn: true })).toEqual({
        ok: false,
        reason: "not_complete",
      });
      engagement.status = "cancelled";
      expect(await sendEngagementInvoice("e1", { atSpawn: true })).toEqual({
        ok: false,
        reason: "not_complete",
      });
      expect(createPaymentRequest).not.toHaveBeenCalled();
    });

    it("atSpawn keeps the one-invoice idempotency (existing request → already_sent)", async () => {
      engagement.status = "sent";
      getLatestPaymentRequest.mockResolvedValue({
        id: "pay-0",
        status: "requested",
      });
      expect(await sendEngagementInvoice("e1", { atSpawn: true })).toEqual({
        ok: false,
        reason: "already_sent",
      });
      expect(createPaymentRequest).not.toHaveBeenCalled();
    });
  });
});

describe("sendEngagementInvoice — the deposit (migration 1680)", () => {
  it("bills the DEPOSIT amount, not the engagement's fee", async () => {
    // Two different charges on one job.
    engagement.status = "in_progress";
    engagement.deposit_cents = 10_000;
    getLatestPaymentRequest.mockResolvedValue(null);
    getFirmInvoiceSettingsSR.mockResolvedValue(null);

    const res = await sendEngagementInvoice("e1", { kind: "deposit" });

    expect(res.ok).toBe(true);
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 10_000, kind: "deposit" }),
    );
  });

  it("bills a LIVE engagement — a deposit is owed on acceptance, not at the end", async () => {
    engagement.status = "sent";
    engagement.deposit_cents = 10_000;
    getLatestPaymentRequest.mockResolvedValue(null);
    getFirmInvoiceSettingsSR.mockResolvedValue(null);

    const res = await sendEngagementInvoice("e1", { kind: "deposit" });
    expect(res.ok).toBe(true);
  });

  it("raises nothing when no deposit was promised", async () => {
    // Silence, not a zero-dollar invoice.
    engagement.status = "in_progress";
    engagement.deposit_cents = null;
    getLatestPaymentRequest.mockResolvedValue(null);

    const res = await sendEngagementInvoice("e1", { kind: "deposit" });
    expect(res).toEqual({ ok: false, reason: "no_amount" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("the ENGAGEMENT invoice still carries its own kind and its own amount", async () => {
    engagement.status = "complete";
    engagement.deposit_cents = 10_000;
    getLatestPaymentRequest.mockResolvedValue(null);
    getFirmInvoiceSettingsSR.mockResolvedValue(null);

    await sendEngagementInvoice("e1");
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 25_000, kind: "engagement" }),
    );
  });
});

describe("the deposit comes off the final invoice", () => {
  beforeEach(() => {
    paidDepositRows = [];
  });

  it("bills the BALANCE once a deposit has been paid", async () => {
    // The founder, asked directly whether a $1,000 deposit on a $5,000
    // engagement leaves a $4,000 or a $5,000 final invoice: "The balance
    // obviously." Without this the client is billed $6,000 for a $5,000 job.
    paidDepositRows = [{ amount_cents: 10_000 }];
    const result = await sendEngagementInvoice("e1");
    expect(result.ok).toBe(true);
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 15_000, kind: "engagement" }),
    );
  });

  it("bills the full fee when the deposit was never paid", async () => {
    // An UNPAID deposit has taken no money; deducting it would bill the client
    // less than they owe. The engagement carries deposit_cents either way.
    paidDepositRows = [];
    const result = await sendEngagementInvoice("e1");
    expect(result.ok).toBe(true);
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 25_000 }),
    );
  });

  it("sums several settled deposits rather than crediting only one", async () => {
    paidDepositRows = [{ amount_cents: 6_000 }, { amount_cents: 4_000 }];
    await sendEngagementInvoice("e1");
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 15_000 }),
    );
  });

  it("raises NOTHING when the deposit already covered the whole engagement", async () => {
    // A correct outcome, not a failure: the money is collected, and a $0
    // invoice would ask the client to pay nothing.
    paidDepositRows = [{ amount_cents: 25_000 }];
    const result = await sendEngagementInvoice("e1");
    expect(result).toEqual({ ok: false, reason: "no_amount" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("does NOT credit the deposit against the deposit invoice itself", async () => {
    // Netting a charge against itself would raise a $0 deposit, or nothing.
    engagement.status = "in_progress";
    paidDepositRows = [{ amount_cents: 10_000 }];
    const result = await sendEngagementInvoice("e1", { kind: "deposit" });
    expect(result.ok).toBe(true);
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 10_000, kind: "deposit" }),
    );
  });
});

describe("the invoice is built FROM the agreed service lines", () => {
  beforeEach(() => {
    paidDepositRows = [];
    serviceLineRows = [];
    getFirmInvoiceSettingsSR.mockResolvedValue(QC_SETTINGS);
    allocateInvoiceSeqSR.mockResolvedValue(7);
  });

  it("states each agreed service as its own line, not one flat amount", async () => {
    // Founder: "theres no like actual generate invoice document. When we have a
    // whole invoice generator inside of vylan already." A client who agreed to
    // four priced services was receiving a single-line bill matching none.
    serviceLineRows = [
      { name: "T2 Preparation", rate_cents: 400_000, rate_type: "item", billing_frequency: "once" },
      { name: "Bookkeeping cleanup", rate_cents: 120_000, rate_type: "item", billing_frequency: "once" },
    ];
    await sendEngagementInvoice("e1");
    const input = createPaymentRequest.mock.calls[0][0] as {
      line_items: Array<{ description: string; amount_cents: number }>;
      subtotal_cents: number;
    };
    expect(input.line_items.map((l) => l.description)).toEqual([
      "T2 Preparation",
      "Bookkeeping cleanup",
    ]);
    expect(input.subtotal_cents).toBe(520_000);
  });

  it("shows a settled deposit as a visible CREDIT line, not silent arithmetic", async () => {
    serviceLineRows = [
      { name: "T2 Preparation", rate_cents: 400_000, rate_type: "item", billing_frequency: "once" },
    ];
    paidDepositRows = [{ amount_cents: 100_000 }];
    await sendEngagementInvoice("e1");
    const input = createPaymentRequest.mock.calls[0][0] as {
      line_items: Array<{ description: string; amount_cents: number }>;
      subtotal_cents: number;
    };
    expect(input.line_items).toHaveLength(2);
    expect(input.line_items[1].description).toMatch(/deposit/i);
    expect(input.line_items[1].amount_cents).toBe(-100_000);
    // Tax is computed on the SUBTOTAL, so the credit reduces the taxable base —
    // which is also the right accounting answer.
    expect(input.subtotal_cents).toBe(300_000);
  });

  it("excludes an hourly line, which has no knowable amount", async () => {
    serviceLineRows = [
      { name: "T2 Preparation", rate_cents: 400_000, rate_type: "item", billing_frequency: "once" },
      { name: "Advisory", rate_cents: 15_000, rate_type: "hour", billing_frequency: "once" },
    ];
    await sendEngagementInvoice("e1");
    const input = createPaymentRequest.mock.calls[0][0] as {
      line_items: Array<{ description: string }>;
    };
    expect(input.line_items.map((l) => l.description)).toEqual(["T2 Preparation"]);
  });

  it("falls back to the single flat line when there are no priced services", async () => {
    // Nothing that invoices correctly today changes.
    serviceLineRows = [];
    await sendEngagementInvoice("e1");
    const input = createPaymentRequest.mock.calls[0][0] as {
      line_items: Array<{ amount_cents: number }>;
    };
    expect(input.line_items).toHaveLength(1);
    expect(input.line_items[0].amount_cents).toBe(25_000);
  });

  it("does not itemise a DEPOSIT invoice — it is one agreed amount", async () => {
    engagement.status = "in_progress";
    serviceLineRows = [
      { name: "T2 Preparation", rate_cents: 400_000, rate_type: "item", billing_frequency: "once" },
    ];
    await sendEngagementInvoice("e1", { kind: "deposit" });
    const input = createPaymentRequest.mock.calls[0][0] as {
      line_items: Array<{ amount_cents: number }>;
      kind: string;
    };
    expect(input.kind).toBe("deposit");
    expect(input.line_items).toHaveLength(1);
    expect(input.line_items[0].amount_cents).toBe(10_000);
  });
});

describe("the ON-ACCEPTANCE invoice can actually be raised", () => {
  it("bills a LIVE engagement when atAcceptance is set", async () => {
    // The bug this exists for. kind='engagement' demands a COMPLETE engagement,
    // and an engagement being accepted is 'sent' — so applyAcceptedBilling
    // called this, got `not_complete`, and raised nothing. Every single time.
    // The founder accepted a $459.90 on-acceptance engagement and its row had
    // ZERO payment_requests against it.
    engagement.status = "sent";
    const result = await sendEngagementInvoice("e1", { atAcceptance: true });
    expect(result.ok).toBe(true);
    expect(createPaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ amount_cents: 25_000, kind: "engagement" }),
    );
  });

  it("still refuses a live engagement WITHOUT the flag", async () => {
    // The completion rule is right for a normal end-of-job invoice and must not
    // be loosened for everyone just because acceptance needs an exception.
    engagement.status = "sent";
    const result = await sendEngagementInvoice("e1");
    expect(result).toEqual({ ok: false, reason: "not_complete" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
  });

  it("refuses a CANCELLED engagement even with the flag", async () => {
    // atAcceptance means "live, not finished" — never "any status at all".
    engagement.status = "cancelled";
    const result = await sendEngagementInvoice("e1", { atAcceptance: true });
    expect(result).toEqual({ ok: false, reason: "not_complete" });
  });
});

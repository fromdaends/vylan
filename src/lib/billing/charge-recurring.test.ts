import { beforeEach, describe, expect, it, vi } from "vitest";
import { dueDateFrom, todayIsoDay } from "@/lib/invoices/terms";
import type { BillingSchedule } from "@/lib/db/billing-schedules";

// The chase block is what these tests exist for: the period invoice this
// module raises showed "auto-chase on" in Billing while no reminder was ever
// queued — the same lie send.ts's chase block was written to end, on the one
// automated path that fix missed.

const createPaymentRequest = vi.fn();
const claimBillingPeriod = vi.fn();
const releaseBillingPeriod = vi.fn();
const advanceBillingSchedule = vi.fn();
const linkChargeToPaymentRequest = vi.fn();
const setBillingScheduleStatus = vi.fn();
const getFirmInvoiceSettingsSR = vi.fn();
const allocateInvoiceSeqSR = vi.fn();
const getChaseSettingsSR = vi.fn();
const scheduleInvoiceChase = vi.fn();
const chaseSettingsWithFlowOverride = vi.fn();
const sendEmail = vi.fn();
const autoChaseUpdate = vi.fn();

const engagement = {
  id: "e1",
  title: "Monthly bookkeeping",
  status: "in_progress",
  magic_token: "token-1",
};

// The engagement's recurring lines at the schedule's frequency. One priced
// fixed line by default, so the charge goes through.
let itemRows: Array<Record<string, unknown>> = [
  {
    name: "Bookkeeping",
    description: null,
    rate_cents: 40_000,
    rate_type: "item",
    billing_frequency: "monthly",
    order_index: 0,
  },
];

const serviceRole = {
  from(table: string) {
    return {
      select() {
        const builder = {
          eq: () => builder,
          order: () => builder,
          // recurringLinesFor awaits the builder directly for a LIST; the
          // engagement/client reads call maybeSingle. One thenable object
          // serves both, same shape as send.test.ts.
          then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
            return Promise.resolve({
              data: table === "engagement_items" ? itemRows : [],
              error: null,
            }).then(resolve);
          },
          async maybeSingle() {
            if (table === "engagements") return { data: engagement };
            if (table === "clients") {
              return {
                data: {
                  id: "c1",
                  display_name: "Jordan",
                  email: "jordan@example.com",
                  locale: "en",
                  archived_at: null,
                },
              };
            }
            return { data: null };
          },
        };
        return builder;
      },
      insert: () => Promise.resolve({ error: null }),
      update(input: unknown) {
        return {
          eq: (col: string, id: unknown) => {
            autoChaseUpdate(table, input, id);
            return Promise.resolve({ error: null });
          },
        };
      },
    };
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => serviceRole,
}));
vi.mock("@/lib/db/payment-requests", () => ({
  createPaymentRequestSR: (input: unknown) => createPaymentRequest(input),
}));
vi.mock("@/lib/db/billing-schedules", () => ({
  claimBillingPeriodSR: (input: unknown) => claimBillingPeriod(input),
  releaseBillingPeriodSR: (id: string) => releaseBillingPeriod(id),
  advanceBillingScheduleSR: (id: string, next: string) =>
    advanceBillingSchedule(id, next),
  linkChargeToPaymentRequestSR: (claimId: string, prId: string) =>
    linkChargeToPaymentRequest(claimId, prId),
  setBillingScheduleStatusSR: (id: string, status: string) =>
    setBillingScheduleStatus(id, status),
}));
vi.mock("@/lib/db/invoice-settings", () => ({
  getFirmInvoiceSettingsSR: (firmId: string) => getFirmInvoiceSettingsSR(firmId),
  allocateInvoiceSeqSR: (firmId: string) => allocateInvoiceSeqSR(firmId),
  getChaseSettingsSR: (firmId: string) => getChaseSettingsSR(firmId),
}));
vi.mock("@/lib/invoices/chase", () => ({
  scheduleInvoiceChase: (opts: unknown) => scheduleInvoiceChase(opts),
}));
vi.mock("@/lib/invoices/chase-flow", () => ({
  chaseSettingsWithFlowOverride: (sb: unknown, opts: unknown) =>
    chaseSettingsWithFlowOverride(sb, opts),
}));
vi.mock("@/lib/email", () => ({
  buildPaymentRequestEmail: () => ({ subject: "s", html: "h", text: "t" }),
  sendEmail: (input: unknown) => sendEmail(input),
}));
vi.mock("@/lib/storage", () => ({
  getBrandingImageUrlForEmail: async () => null,
}));
vi.mock("@/lib/db/quickbooks", () => ({
  isMissingSchema: () => false,
}));

import { chargeSchedulePeriod } from "./charge-recurring";

const schedule: BillingSchedule = {
  id: "sch-1",
  firm_id: "f1",
  client_id: "c1",
  engagement_id: "e1",
  frequency: "monthly",
  anchor_day: 1,
  next_charge_on: "2026-08-01",
  ends_on: null,
  status: "active",
  description: null,
  created_at: "2026-07-01T00:00:00Z",
  ended_at: null,
};

const firm = {
  id: "f1",
  name: "Acme",
  timezone: "America/Toronto",
  logo_url: null,
  connect_charges_enabled: true,
};

// Mid-month, so an Aug 1 monthly schedule is due for period 2026-08.
const NOW = new Date("2026-08-15T12:00:00Z");

const CHASE_ON = { enabledDefault: true, intervalDays: 7, maxReminders: 4 };
const CHASE_OFF = { enabledDefault: false, intervalDays: 7, maxReminders: 4 };

beforeEach(() => {
  vi.clearAllMocks();
  engagement.status = "in_progress";
  itemRows = [
    {
      name: "Bookkeeping",
      description: null,
      rate_cents: 40_000,
      rate_type: "item",
      billing_frequency: "monthly",
      order_index: 0,
    },
  ];
  createPaymentRequest.mockResolvedValue({ id: "pay-1" });
  claimBillingPeriod.mockResolvedValue({ id: "claim-1" });
  sendEmail.mockResolvedValue({ sent: true });
  // No Invoicing settings by default: flat charge, no issue/due dates.
  getFirmInvoiceSettingsSR.mockResolvedValue(null);
  allocateInvoiceSeqSR.mockResolvedValue(null);
  getChaseSettingsSR.mockResolvedValue(CHASE_ON);
  scheduleInvoiceChase.mockResolvedValue(2);
  // Default: no flow opinion — the firm settings pass through untouched,
  // which is chaseSettingsWithFlowOverride's own fail-soft behaviour.
  chaseSettingsWithFlowOverride.mockImplementation(
    async (_sb: unknown, opts: { base: unknown }) => opts.base,
  );
});

describe("chargeSchedulePeriod — the chase on a period invoice", () => {
  it("schedules the chase for the invoice it just raised", async () => {
    const result = await chargeSchedulePeriod(schedule, firm, NOW);

    expect(result).toEqual({
      ok: true,
      paymentRequestId: "pay-1",
      periodKey: "2026-08",
      cents: 40_000,
    });
    expect(scheduleInvoiceChase).toHaveBeenCalledWith({
      invoiceId: "pay-1",
      issuedOn: todayIsoDay(),
      dueDate: null,
      settings: CHASE_ON,
    });
    // The row keeps its armed default — nothing writes auto_chase.
    expect(autoChaseUpdate).not.toHaveBeenCalled();
  });

  it("resolves the cadence through the flow override, for THIS engagement", async () => {
    await chargeSchedulePeriod(schedule, firm, NOW);
    expect(chaseSettingsWithFlowOverride).toHaveBeenCalledWith(
      expect.anything(),
      { base: CHASE_ON, engagementId: "e1", firmId: "f1" },
    );
  });

  it("a flow's own cadence outranks the firm default", async () => {
    // The firm-wide switch is off, but this engagement's flow says chase
    // every 3 days — the flow raised this money, its opinion wins.
    getChaseSettingsSR.mockResolvedValue(CHASE_OFF);
    const flowCadence = { enabledDefault: true, intervalDays: 3, maxReminders: 2 };
    chaseSettingsWithFlowOverride.mockResolvedValue(flowCadence);

    await chargeSchedulePeriod(schedule, firm, NOW);

    expect(scheduleInvoiceChase).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: "pay-1", settings: flowCadence }),
    );
    expect(autoChaseUpdate).not.toHaveBeenCalled();
  });

  it("carries the generated invoice's own due date onto the chase", async () => {
    getFirmInvoiceSettingsSR.mockResolvedValue({
      firm_id: "f1",
      province: "QC",
      gst_number: null,
      qst_number: null,
      pst_number: null,
      invoice_prefix: "INV-",
      default_terms: null,
      default_notes: null,
      default_taxes_enabled: false,
      default_due_days: 14,
    });
    await chargeSchedulePeriod(schedule, firm, NOW);
    expect(scheduleInvoiceChase).toHaveBeenCalledWith(
      expect.objectContaining({
        issuedOn: todayIsoDay(),
        dueDate: dueDateFrom(todayIsoDay(), 14),
      }),
    );
  });

  it("chase off → writes auto_chase=false so the row cannot read as armed", async () => {
    // The exact lie this block exists to end: the Billing table showing
    // "auto-chase on" (the column's default) while nothing is queued.
    getChaseSettingsSR.mockResolvedValue(CHASE_OFF);

    const result = await chargeSchedulePeriod(schedule, firm, NOW);

    expect(result.ok).toBe(true);
    expect(scheduleInvoiceChase).not.toHaveBeenCalled();
    expect(autoChaseUpdate).toHaveBeenCalledWith(
      "payment_requests",
      { auto_chase: false },
      "pay-1",
    );
  });

  it("a chase hiccup never undoes the charge", async () => {
    scheduleInvoiceChase.mockRejectedValue(new Error("queue down"));
    const result = await chargeSchedulePeriod(schedule, firm, NOW);
    expect(result.ok).toBe(true);
    expect(linkChargeToPaymentRequest).toHaveBeenCalledWith("claim-1", "pay-1");
    expect(advanceBillingSchedule).toHaveBeenCalled();
  });

  it("schedules nothing when the invoice itself was not created", async () => {
    createPaymentRequest.mockResolvedValue(null);
    const result = await chargeSchedulePeriod(schedule, firm, NOW);
    expect(result).toEqual({ ok: false, reason: "create_failed" });
    expect(scheduleInvoiceChase).not.toHaveBeenCalled();
    expect(autoChaseUpdate).not.toHaveBeenCalled();
  });

  it("schedules nothing for a period that is not yet due", async () => {
    const early = new Date("2026-07-20T12:00:00Z");
    const result = await chargeSchedulePeriod(schedule, firm, early);
    expect(result).toEqual({ ok: false, reason: "not_due" });
    expect(createPaymentRequest).not.toHaveBeenCalled();
    expect(scheduleInvoiceChase).not.toHaveBeenCalled();
  });
});

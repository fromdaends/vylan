import { describe, expect, it } from "vitest";
import { engagementMatchesSeries } from "./sync";
import { DEFAULT_REMINDER_SETTINGS } from "@/lib/reminder-settings";
import type { SeriesInvoiceSnapshot } from "./invoice-snapshot";

const item = (over: Partial<Record<string, unknown>> = {}) => ({
  label_en: "Bank statement",
  label_fr: "Relevé bancaire",
  description_en: null,
  description_fr: null,
  doc_type: "bank_statement" as const,
  required: true,
  ...over,
});

const invoiceSnap = {
  timing: "at_spawn" as const,
  delay_days: null,
  amount_cents: 1_000,
  locks_deliverables: false,
  description: null,
};

function base() {
  return {
    series: {
      items: [item()],
      reminder_settings: DEFAULT_REMINDER_SETTINGS as unknown,
      ai_enabled: true,
      invoice_recreate: false,
      invoiceSnapshot: null as SeriesInvoiceSnapshot | null,
    },
    engagement: {
      itemsSnapshot: [item()],
      reminder_settings: DEFAULT_REMINDER_SETTINGS as unknown,
      ai_enabled: true,
      invoiceSnapshot: null as SeriesInvoiceSnapshot | null,
    },
  };
}

describe("engagementMatchesSeries", () => {
  it("matches when everything is identical", () => {
    expect(engagementMatchesSeries(base())).toBe(true);
  });

  it("flags an added, changed, or reordered checklist item", () => {
    const added = base();
    added.engagement.itemsSnapshot = [item(), item({ label_en: "Receipts" })];
    expect(engagementMatchesSeries(added)).toBe(false);

    const changed = base();
    changed.engagement.itemsSnapshot = [item({ required: false })];
    expect(engagementMatchesSeries(changed)).toBe(false);

    const reordered = base();
    reordered.series.items = [item(), item({ label_en: "Receipts" })];
    reordered.engagement.itemsSnapshot = [
      item({ label_en: "Receipts" }),
      item(),
    ];
    expect(engagementMatchesSeries(reordered)).toBe(false);
  });

  it("treats null and missing descriptions as equal", () => {
    const d = base();
    d.series.items = [item({ description_en: null })];
    d.engagement.itemsSnapshot = [item({ description_en: undefined })];
    expect(engagementMatchesSeries(d)).toBe(true);
  });

  it("flags changed reminder settings, comparing normalized forms", () => {
    const d = base();
    d.engagement.reminder_settings = {
      ...structuredClone(DEFAULT_REMINDER_SETTINGS),
      enabled: false,
    };
    expect(engagementMatchesSeries(d)).toBe(false);
    // Garbage on either side normalizes to the default — equal to default.
    const g = base();
    g.engagement.reminder_settings = null;
    expect(engagementMatchesSeries(g)).toBe(true);
  });

  it("flags the AI toggle", () => {
    const d = base();
    d.engagement.ai_enabled = false;
    expect(engagementMatchesSeries(d)).toBe(false);
  });

  it("compares invoices only when recurrence is ON", () => {
    const off = base();
    off.engagement.invoiceSnapshot = invoiceSnap;
    expect(engagementMatchesSeries(off)).toBe(true);

    const on = base();
    on.series.invoice_recreate = true;
    on.series.invoiceSnapshot = invoiceSnap;
    on.engagement.invoiceSnapshot = { ...invoiceSnap, amount_cents: 2_000 };
    expect(engagementMatchesSeries(on)).toBe(false);
  });

  it("vanished invoice material is NOT a difference (refresh would keep the stored snapshot)", () => {
    const d = base();
    d.series.invoice_recreate = true;
    d.series.invoiceSnapshot = invoiceSnap;
    d.engagement.invoiceSnapshot = null;
    expect(engagementMatchesSeries(d)).toBe(true);
  });
});

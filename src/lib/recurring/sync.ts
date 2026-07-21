// Is this engagement out of sync with its series? Pure comparison between
// what the engagement currently is (checklist / reminders / AI / invoice)
// and what the series' stored snapshot would spawn — drives the "Apply to
// future occurrences?" prompt and the Repeat dialog's edit-future box, which
// only appear when there is actually something to apply.
//
// Semantics deliberately mirror refreshSeriesSnapshotAction (what the
// "update the series" button would write): if applying would change nothing,
// we are in sync — e.g. vanished invoice material is NOT a difference,
// because the refresh keeps the stored snapshot in that case.

import type { TemplateItem } from "@/lib/db/templates";
import {
  normalizeReminderSettings,
  type ReminderSettings,
} from "@/lib/reminder-settings";
import type { SeriesInvoiceSnapshot } from "./invoice-snapshot";

// Normalized field-by-field comparison; order matters (spawns copy order).
function itemsEqual(a: TemplateItem[], b: TemplateItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.label_en !== y.label_en ||
      x.label_fr !== y.label_fr ||
      (x.description_en ?? null) !== (y.description_en ?? null) ||
      (x.description_fr ?? null) !== (y.description_fr ?? null) ||
      x.doc_type !== y.doc_type ||
      x.required !== y.required
    ) {
      return false;
    }
  }
  return true;
}

// normalizeReminderSettings builds objects with a stable shape, so JSON
// equality is a faithful comparison.
function remindersEqual(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(normalizeReminderSettings(a as ReminderSettings)) ===
    JSON.stringify(normalizeReminderSettings(b as ReminderSettings))
  );
}

function invoiceSnapshotsEqual(
  a: SeriesInvoiceSnapshot | null,
  b: SeriesInvoiceSnapshot | null,
): boolean {
  if (a == null || b == null) return a === b;
  return (
    a.timing === b.timing &&
    a.delay_days === b.delay_days &&
    a.amount_cents === b.amount_cents &&
    a.locks_deliverables === b.locks_deliverables &&
    (a.description ?? null) === (b.description ?? null)
  );
}

export function engagementMatchesSeries(input: {
  series: {
    items: TemplateItem[];
    reminder_settings: unknown;
    ai_enabled: boolean;
    invoice_recreate: boolean;
    // Parsed stored snapshot (null when none / unparseable).
    invoiceSnapshot: SeriesInvoiceSnapshot | null;
  };
  engagement: {
    // snapshotFromRequestItems of the CURRENT checklist.
    itemsSnapshot: TemplateItem[];
    reminder_settings: unknown;
    ai_enabled: boolean;
    // deriveInvoiceSnapshotFromEngagement of the CURRENT invoice material
    // (null when there is nothing to derive).
    invoiceSnapshot: SeriesInvoiceSnapshot | null;
  };
}): boolean {
  if (!itemsEqual(input.series.items, input.engagement.itemsSnapshot)) {
    return false;
  }
  if (
    !remindersEqual(
      input.series.reminder_settings,
      input.engagement.reminder_settings,
    )
  ) {
    return false;
  }
  if (input.series.ai_enabled !== input.engagement.ai_enabled) return false;
  // Invoice: only meaningful when recurrence is on, and only when the
  // engagement still HAS material to derive (the refresh keeps the stored
  // snapshot otherwise, so "material gone" applies nothing = in sync).
  if (
    input.series.invoice_recreate &&
    input.engagement.invoiceSnapshot != null &&
    !invoiceSnapshotsEqual(
      input.series.invoiceSnapshot,
      input.engagement.invoiceSnapshot,
    )
  ) {
    return false;
  }
  return true;
}

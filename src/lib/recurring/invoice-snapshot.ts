// The series' invoice snapshot (Phase 4): what "recreate this invoice each
// cycle" copies onto every spawned occurrence. Stored as JSONB on
// recurring_series.invoice_snapshot (columns shipped with 0770), so it can
// outlive the code version that wrote it — parse defensively, never trust.
//
// Timing semantics — how this coexists with the invoice Automation tab:
//   * 'at_spawn'       — the original had an invoice payable up front (created
//                        at engagement creation or requested manually). Each
//                        occurrence gets its own fresh invoice the moment it
//                        spawns.
//   * 'on_completion'  — the original used the Automation tab's "on
//   * 'delayed'          completion" / "delayed" send. Each occurrence carries
//                        the SAME automation settings, and the existing
//                        dispatcher fires its invoice when that occurrence is
//                        completed. The recurrence decides WHETHER each new
//                        occurrence bills; the Automation timing decides WHEN.
//
// The amount is the flat captured amount. At fire time the existing machinery
// upgrades it exactly like any automation invoice: once the firm has Invoicing
// set up, it becomes a generated invoice with default taxes and a fresh
// sequential number, in the client's language. A hand-built multi-line
// invoice snapshots as its total (v1 — same behavior automation has today).

import type { Engagement } from "@/lib/db/engagements";

export type SeriesInvoiceTiming = "at_spawn" | "on_completion" | "delayed";

export type SeriesInvoiceSnapshot = {
  timing: SeriesInvoiceTiming;
  // Days after completion, 'delayed' timing only.
  delay_days: number | null;
  amount_cents: number;
  locks_deliverables: boolean;
  description: string | null;
};

const TIMINGS = new Set<SeriesInvoiceTiming>([
  "at_spawn",
  "on_completion",
  "delayed",
]);

// Stripe floor ($0.50) to rail ceiling — same bounds the create paths enforce.
function isValidAmount(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isInteger(v) &&
    v >= 50 &&
    v <= 99_999_999
  );
}

export function parseInvoiceSnapshot(
  value: unknown,
): SeriesInvoiceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!TIMINGS.has(v.timing as SeriesInvoiceTiming)) return null;
  if (!isValidAmount(v.amount_cents)) return null;
  const timing = v.timing as SeriesInvoiceTiming;
  const rawDelay = v.delay_days;
  const delay =
    typeof rawDelay === "number" && Number.isInteger(rawDelay) && rawDelay >= 1
      ? Math.min(365, rawDelay)
      : null;
  // A 'delayed' snapshot without a usable delay can't schedule — reject it
  // rather than guessing.
  if (timing === "delayed" && delay == null) return null;
  return {
    timing,
    delay_days: timing === "delayed" ? delay : null,
    amount_cents: v.amount_cents as number,
    locks_deliverables: v.locks_deliverables === true,
    description:
      typeof v.description === "string" && v.description.trim() !== ""
        ? v.description.trim().slice(0, 500)
        : null,
  };
}

// Derive the snapshot from an engagement's CURRENT invoice material — the one
// precedence rule, shared by the Repeat dialog's switch and the edit-future
// refresh so they can never disagree:
//   1. Automation configured (mode + amount) -> that automation, verbatim.
//   2. Otherwise a live (non-canceled) invoice row -> 'at_spawn' with the
//      row's amount / lock / description.
//   3. Otherwise -> null (nothing to recreate; the switch isn't offered).
export function deriveInvoiceSnapshotFromEngagement(
  engagement: Pick<
    Engagement,
    | "invoice_auto_mode"
    | "invoice_delay_days"
    | "invoice_amount_cents"
    | "invoice_locks_deliverables"
    | "invoice_description"
  >,
  latestInvoice: {
    status: string;
    amount_cents: number;
    locks_deliverables: boolean;
    description: string | null;
  } | null,
): SeriesInvoiceSnapshot | null {
  const mode = engagement.invoice_auto_mode ?? "off";
  if (
    (mode === "on_completion" || mode === "delayed") &&
    isValidAmount(engagement.invoice_amount_cents)
  ) {
    return parseInvoiceSnapshot({
      timing: mode,
      delay_days: engagement.invoice_delay_days ?? null,
      amount_cents: engagement.invoice_amount_cents,
      locks_deliverables: engagement.invoice_locks_deliverables === true,
      description: engagement.invoice_description ?? null,
    });
  }
  if (
    latestInvoice &&
    latestInvoice.status !== "canceled" &&
    isValidAmount(latestInvoice.amount_cents)
  ) {
    return parseInvoiceSnapshot({
      timing: "at_spawn",
      delay_days: null,
      amount_cents: latestInvoice.amount_cents,
      locks_deliverables: latestInvoice.locks_deliverables === true,
      description: latestInvoice.description,
    });
  }
  return null;
}

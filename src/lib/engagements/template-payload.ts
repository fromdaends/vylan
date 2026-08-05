// What an engagement template stores, and how to read one safely.
//
// The payload is jsonb (migration 1500) because it snapshots BUILDER STATE and
// the builder is still growing — Terms and Tasks are still to come. The trade
// is that the database validates nothing, so this module is the only place that
// knows the shape, and it treats every field as optional.
//
// THE RULE THAT MATTERS: a template saved by today's builder will be read by a
// LATER builder with more steps, and a template saved by a later builder may be
// read by an older deployment mid-rollout. So reading is total — anything
// missing, extra or malformed degrades to a sensible default rather than
// throwing. A template that half-loads is worth far more than one that errors.

import {
  BILLING_FREQUENCIES,
  RATE_TYPES,
  type BillingFrequency,
  type EngagementItemDraft,
  type RateType,
} from "@/lib/engagements/items";

/** A document request line, as the builder holds it. */
export type TemplateChecklistItem = {
  label_en: string;
  label_fr: string;
  description_en: string | null;
  description_fr: string | null;
  doc_type: string | null;
  required: boolean;
};

export type EngagementTemplatePayload = {
  /** The engagement's own title, not the template's name. */
  title: string;
  type: string | null;
  /** Priced scope. */
  items: EngagementItemDraft[];
  /** What the client is asked to send. */
  checklist: TemplateChecklistItem[];
  /**
   * Canopy's "Engagement period begins on" — Acceptance, or a fixed date.
   *
   * On a TEMPLATE this is only ever the rule, never a resolved date: a template
   * reused next season must not carry last season's start. "custom" here means
   * "ask when the engagement is created".
   */
  periodStartsOn: "acceptance" | "custom";
  /**
   * Canopy's "Engagement period" — how long it runs, in months. Null is
   * Canopy's "Ongoing", which is the honest default for bookkeeping.
   */
  periodMonths: number | null;
  /** The covering note at the top of the client's proposal. */
  introMessage: string;
  /** Whatever the invoice step captured. Opaque here on purpose. */
  invoice: Record<string, unknown> | null;
  /** Whatever the reminders step captured. Opaque here on purpose. */
  reminders: Record<string, unknown> | null;
  repeat: Record<string, unknown> | null;
};

export function emptyPayload(): EngagementTemplatePayload {
  return {
    title: "",
    type: null,
    periodStartsOn: "acceptance",
    periodMonths: null,
    introMessage: "",
    items: [],
    checklist: [],
    invoice: null,
    reminders: null,
    repeat: null,
  };
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function readItem(raw: unknown): EngagementItemDraft | null {
  const o = obj(raw);
  if (!o) return null;
  const name = str(o.name).trim();
  // A line with no name is not a line. Templates saved from a builder where
  // somebody clicked "+ Add" and stopped should not resurrect as blank rows.
  if (name === "") return null;

  const rateType = RATE_TYPES.includes(o.rateType as RateType)
    ? (o.rateType as RateType)
    : "item";
  const billingFrequency = BILLING_FREQUENCIES.includes(
    o.billingFrequency as BillingFrequency,
  )
    ? (o.billingFrequency as BillingFrequency)
    : "once";

  return {
    name,
    // Provenance is NOT carried into a template. A template is not an instance
    // of a service — it is a shape of work, and the catalogue entry it came
    // from may since have been retired.
    serviceId: null,
    description: strOrNull(o.description),
    // Integer cents only. A non-integer means the payload was written by
    // something that did not respect the cents rule, and guessing is worse than
    // "not priced yet".
    rateCents:
      typeof o.rateCents === "number" && Number.isInteger(o.rateCents)
        ? o.rateCents
        : null,
    rateType,
    billingFrequency,
    taxPct:
      typeof o.taxPct === "number" && Number.isFinite(o.taxPct)
        ? o.taxPct
        : null,
  };
}

function readChecklistItem(raw: unknown): TemplateChecklistItem | null {
  const o = obj(raw);
  if (!o) return null;
  const en = str(o.label_en).trim();
  const fr = str(o.label_fr).trim();
  if (en === "" && fr === "") return null;
  return {
    // One language filled and the other blank is normal — the builder lets you
    // write either. Mirror rather than leave a side empty, so the client always
    // sees SOMETHING whichever language their portal is in.
    label_en: en || fr,
    label_fr: fr || en,
    description_en: strOrNull(o.description_en),
    description_fr: strOrNull(o.description_fr),
    doc_type: strOrNull(o.doc_type),
    required: o.required === true,
  };
}

/** Read a stored payload. Never throws; unknown shapes degrade to defaults. */
/**
 * Months, or null for Canopy's "Ongoing".
 *
 * Refuses anything that is not a positive whole number of months — a fractional
 * or negative period is not a period, and storing one would put nonsense in
 * front of a client. 120 (ten years) is the ceiling; past that it IS ongoing.
 */
function readPeriodMonths(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (v < 1 || v > 120) return null;
  return v;
}

export function readPayload(raw: unknown): EngagementTemplatePayload {
  const o = obj(raw);
  if (!o) return emptyPayload();
  return {
    title: str(o.title),
    type: strOrNull(o.type),
    // Anything that is not literally "custom" is acceptance — the safe default,
    // because a template whose start rule failed to read should begin when the
    // client agrees rather than on a date nobody chose.
    periodStartsOn: o.periodStartsOn === "custom" ? "custom" : "acceptance",
    periodMonths: readPeriodMonths(o.periodMonths),
    introMessage: str(o.introMessage),
    items: arr(o.items)
      .map(readItem)
      .filter((i): i is EngagementItemDraft => i != null),
    checklist: arr(o.checklist)
      .map(readChecklistItem)
      .filter((i): i is TemplateChecklistItem => i != null),
    invoice: obj(o.invoice),
    reminders: obj(o.reminders),
    repeat: obj(o.repeat),
  };
}

/**
 * Is this template worth saving?
 *
 * A template that carries nothing would sit in the picker forever offering an
 * empty engagement, which is what "Create from scratch" is already for.
 */
export function isWorthSaving(p: EngagementTemplatePayload): boolean {
  return (
    p.items.length > 0 ||
    p.checklist.length > 0 ||
    p.invoice != null ||
    p.reminders != null ||
    p.title.trim().length > 0
  );
}

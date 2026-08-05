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
  /**
   * Canopy's "Save draft" — work in progress, kept so you can come back to it.
   *
   * A draft is deliberately allowed to be INCOMPLETE: Canopy's own wording is
   * "store incomplete work". So it skips the worth-saving check that a finished
   * template must pass, and the list marks it so nobody reaches for a template
   * that is half-written.
   *
   * In the payload rather than its own column because `payload` is jsonb and a
   * migration for one boolean is a migration nobody needs.
   */
  isDraft: boolean;
  /**
   * Canopy's three INTRODUCTION rows, each with its own toggle: a welcome
   * message, a video, and a supporting document.
   *
   * The toggle is stored separately from the content on purpose. Turning Video
   * off and back on must not lose the link you already pasted — Canopy's rows
   * behave that way, and it is the difference between a toggle and a delete.
   */
  welcomeEnabled: boolean;
  videoEnabled: boolean;
  /** A YouTube / Vimeo / Zoom link, per Canopy. Not validated here — the reader
   *  is total, and a bad link is the author's to fix, not a reason to lose the
   *  whole template. */
  videoUrl: string;
  documentEnabled: boolean;
  /** The supporting document's name. Vylan has no file picker on this screen
   *  yet, so this records WHAT was meant and the upload follows. */
  documentName: string;
  /** Who the engagements made from this template land on. */
  assigneeIds: string[];
  /** Canopy's Terms tab: general terms, on or off, and the text itself. */
  termsEnabled: boolean;
  termsText: string;
  /** Canopy's Signatures tab: require a deposit before the work starts. */
  depositRequired: boolean;
  /** Cents, like every other money field in this repo. Null = not set, never 0. */
  depositCents: number | null;
  /**
   * ── WHO SIGNS ───────────────────────────────────────────────────────────
   *
   * The founder, on Canopy's Signatures tab: "theres no way to have a signer
   * right now but it would make sense." They are right — `signature_requests`
   * (0400) carries exactly ONE signer, the client, as `signer_email` /
   * `signer_name`. There is no second signer and no firm counter-signature.
   *
   * A TEMPLATE cannot name a person: it has no client, and the staff who work
   * a job change between jobs. So it stores SLOTS, filled when an engagement is
   * created from it. That is the only honest thing a template can hold, and it
   * is what makes "a T1 for a couple always needs two signatures" expressible
   * once instead of remembered every February.
   */
  clientSigns: boolean;
  /**
   * Extra client-side signers, by the ROLE they play — "Spouse", "Second
   * director". Labels, not people: the person is chosen at creation.
   */
  additionalSignerLabels: string[];
  /** Whether someone at the firm counter-signs. */
  firmCountersigns: boolean;
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
    isDraft: false,
    welcomeEnabled: false,
    videoEnabled: false,
    videoUrl: "",
    documentEnabled: false,
    documentName: "",
    assigneeIds: [],
    termsEnabled: false,
    termsText: "",
    depositRequired: false,
    depositCents: null,
    // Defaults to TRUE: an engagement letter the client does not sign is the
    // unusual case, and a template that silently asked nobody to sign would be
    // discovered only when the paperwork was already out.
    clientSigns: true,
    additionalSignerLabels: [],
    firmCountersigns: false,
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
/**
 * Money, in cents.
 *
 * Whole cents only, and never negative. A fractional cent is not money, and a
 * negative deposit is a refund — neither belongs on a template. Null means "not
 * set", which is NOT the same as zero and must never collapse into it.
 */
function readCents(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v)) return null;
  if (v < 0 || v > 99_999_999) return null;
  return v;
}

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
    // Only literal `true` is a draft. Anything else — missing, a string, a
    // number — reads as FINISHED, which is the safe direction: a finished
    // template shown as a draft is confusing, but a draft treated as finished
    // is one somebody sends to a client half-written.
    isDraft: o.isDraft === true,
    welcomeEnabled: o.welcomeEnabled === true,
    videoEnabled: o.videoEnabled === true,
    videoUrl: str(o.videoUrl),
    documentEnabled: o.documentEnabled === true,
    documentName: str(o.documentName),
    // Strings only, each once, order kept. A malformed entry is dropped rather
    // than written to engagements.assigned_user_id, where a non-uuid would
    // fail the insert for everyone using the template.
    assigneeIds: [
      ...new Set(arr(o.assigneeIds).filter((x): x is string => typeof x === "string" && x.length > 0)),
    ],
    termsEnabled: o.termsEnabled === true,
    termsText: str(o.termsText),
    depositRequired: o.depositRequired === true,
    depositCents: readCents(o.depositCents),
    // Absent reads as TRUE — see emptyPayload. Only literal `false` turns the
    // client's signature off, so a template written before this field existed
    // still asks the client to sign.
    clientSigns: o.clientSigns !== false,
    additionalSignerLabels: arr(o.additionalSignerLabels)
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
      .slice(0, 10),
    firmCountersigns: o.firmCountersigns === true,
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

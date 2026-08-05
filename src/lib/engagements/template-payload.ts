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
  BLOCK_FREQUENCIES,
  BILLING_TYPES,
  ONE_TIME_TIMINGS,
  RECURRING_TIMINGS,
  defaultPriceVisibility,
  type BillingBlock,
  type PriceVisibility,
} from "@/lib/engagements/billing-blocks";
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
  /** Priced scope, flat. Kept as the source of truth for totals and invoices —
   *  blocks below are the AUTHORING shape and flatten into this. */
  items: EngagementItemDraft[];
  /**
   * Canopy's billing blocks: services grouped by one billing rule.
   *
   * Empty on a template written before blocks existed, which reads as "the flat
   * list is all there is" — exactly right, and why the flat `items` above stays
   * the thing everything else consumes.
   */
  billingBlocks: BillingBlock[];
  /** Canopy's gear menu: what the client is allowed to see. */
  priceVisibility: PriceVisibility;
  /** What the client is asked to send. */
  checklist: TemplateChecklistItem[];
  /**
   * The WORK this template implies — task template ids (1570).
   *
   * Filled automatically when a service that carries work is picked on the
   * Services tab, because that is what the link is FOR: the founder, on
   * services and tasks, "they're both connected together" and "adding a service
   * should automatically pull tasks in".
   *
   * IDS, not copies. Task templates are a catalogue, and a catalogue stays
   * live: improving the month-end template improves what every future
   * engagement gets. The tasks are frozen only when an engagement is actually
   * created from this — which is the same copy-on-use rule the priced lines
   * follow, one step later.
   *
   * An id whose template has since been deleted simply produces no tasks. That
   * is the honest outcome and the reason nothing downstream may assume this
   * resolves.
   */
  taskTemplateIds: string[];
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
  /**
   * An UPLOADED video, as a storage path. Canopy's row takes either; so does
   * this. Both are kept because switching from a link to a file and back must
   * not lose the one you are not currently using — the same rule as the toggles.
   * The link wins when both are set, because it is the cheaper thing to serve.
   */
  videoPath: string;
  videoFileName: string;
  documentEnabled: boolean;
  /** The supporting document's name — either what was typed, or the uploaded
   *  file's own name. */
  documentName: string;
  /** An uploaded document, as a storage path. */
  documentPath: string;
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
   * Canopy's "Require payment method to be shared for future payments" — the
   * client saves a card when they accept, so a recurring invoice can be charged
   * without asking again.
   *
   * Defaults FALSE. Asking a client to hand over card details is a thing a firm
   * chooses to do, never something a template does on their behalf by omission.
   */
  requirePaymentMethod: boolean;
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
    videoPath: "",
    videoFileName: "",
    documentEnabled: false,
    documentName: "",
    documentPath: "",
    assigneeIds: [],
    termsEnabled: false,
    termsText: "",
    depositRequired: false,
    depositCents: null,
    requirePaymentMethod: false,
    // Defaults to TRUE: an engagement letter the client does not sign is the
    // unusual case, and a template that silently asked nobody to sign would be
    // discovered only when the paperwork was already out.
    clientSigns: true,
    additionalSignerLabels: [],
    firmCountersigns: false,
    items: [],
    billingBlocks: [],
    priceVisibility: defaultPriceVisibility(),
    checklist: [],
    taskTemplateIds: [],
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

/**
 * One billing block, read defensively.
 *
 * Null for anything that is not an object. A block with an unrecognised type or
 * timing falls back to the safe pair (one-time, on acceptance) rather than being
 * dropped: losing the block loses its SERVICES, and a wrong-but-visible billing
 * rule is one the accountant can see and fix, where a missing block is not.
 */
function readBillingBlock(raw: unknown): BillingBlock | null {
  const o = obj(raw);
  if (!o) return null;

  const billingType = (BILLING_TYPES as readonly string[]).includes(
    o.billingType as string,
  )
    ? (o.billingType as BillingBlock["billingType"])
    : "one_time";

  const allowed: readonly string[] =
    billingType === "one_time" ? ONE_TIME_TIMINGS : RECURRING_TIMINGS;
  const timing = allowed.includes(o.timing as string)
    ? (o.timing as BillingBlock["timing"])
    : (allowed[0] as BillingBlock["timing"]);

  return {
    billingType,
    timing,
    frequency: (BLOCK_FREQUENCIES as readonly string[]).includes(
      o.frequency as string,
    )
      ? (o.frequency as BillingBlock["frequency"])
      : "monthly",
    combineItems: o.combineItems === true,
    clientNote: str(o.clientNote),
    items: arr(o.items)
      .map(readItem)
      .filter((i): i is EngagementItemDraft => i != null),
  };
}

/** The three switches. Absent reads as VISIBLE — a client who cannot see what
 *  they are paying for is the surprising state, not the safe one. */
function readPriceVisibility(raw: unknown): PriceVisibility {
  const o = obj(raw);
  if (!o) return defaultPriceVisibility();
  return {
    itemizedPrice: o.itemizedPrice !== false,
    blockTotals: o.blockTotals !== false,
    total: o.total !== false,
  };
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
    videoPath: str(o.videoPath),
    videoFileName: str(o.videoFileName),
    documentEnabled: o.documentEnabled === true,
    documentName: str(o.documentName),
    documentPath: str(o.documentPath),
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
    requirePaymentMethod: o.requirePaymentMethod === true,
    items: arr(o.items)
      .map(readItem)
      .filter((i): i is EngagementItemDraft => i != null),
    billingBlocks: arr(o.billingBlocks)
      .map(readBillingBlock)
      .filter((b): b is BillingBlock => b != null),
    priceVisibility: readPriceVisibility(o.priceVisibility),
    checklist: arr(o.checklist)
      .map(readChecklistItem)
      .filter((i): i is TemplateChecklistItem => i != null),
    // Strings only, de-duplicated, and capped. A template that named the same
    // work twice would create it twice on every engagement made from it.
    taskTemplateIds: Array.from(
      new Set(
        arr(o.taskTemplateIds)
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
          .filter((x) => x.length > 0),
      ),
    ).slice(0, 50),
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
    // Work counts. A template whose only content is "these six tasks" is a
    // perfectly good template — it is what a service-led firm reaches for.
    p.taskTemplateIds.length > 0 ||
    p.invoice != null ||
    p.reminders != null ||
    p.title.trim().length > 0
  );
}

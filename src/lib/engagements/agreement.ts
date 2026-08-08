// The engagement's AGREEMENT STATUS — where the deal is, not where the work is.
//
// The founder's diagnosis, which is correct: "an engagement might have six tasks
// going on simultaneously, and it's hard to put a specific word on what's going
// on... change and make the engagement status like how canopy's is."
//
// WHAT WAS WRONG. `stage` (migration 0690) is a FURTHEST-ALONG-WINS cascade —
// collecting → in_review → in_preparation → awaiting_signature → awaiting_payment
// → completed. That is a PIPELINE, and it is exactly right when an engagement IS
// one document collection moving through phases. It has no honest answer once an
// engagement holds six parallel things: one task waiting on a signature makes the
// whole engagement read "Awaiting signature" while four others are mid-preparation.
//
// The giveaway is already in this repo. engagement_tasks.kind (1370/1400) has
// `document_collection`, `signatures`, `deliverables`, `review` — the SAME
// concepts as the stages. The day tasks got kinds, the stage enum became a
// second and worse description of what the tasks already say precisely.
//
// SO THE SPLIT: this module answers "where is the agreement?" in words that stay
// true however many things are running. The WORK is described by counts and by
// each task's own status — a fact rather than an adjective, and facts do not get
// less true when work happens in parallel. The pipeline is not deleted; it moves
// down onto the document-collection task, which is what it was always describing.
//
// PURE on purpose, like stage.ts: types plus one resolver, no I/O, so the rules
// are provable and every surface reads the same answer.

import type { EngagementStatus } from "@/lib/db/engagements";

/**
 * Canopy's shape. Five words, none of which lie when six things are running.
 *
 * `accepted` is deliberately present before anything can reach it: the client
 * accept step is still to be built, and modelling it now means the surfaces that
 * render this do not all need revisiting the day it lands. Until then nothing
 * resolves to it, which is a state that never appears rather than one that
 * appears wrongly.
 */
export const AGREEMENT_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "active",
  "complete",
  "cancelled",
] as const;

export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export type AgreementFacts = {
  status: EngagementStatus;
  /** Has the client been given the link at all? */
  sentAt: string | null;
  completedAt: string | null;
  /**
   * Has the client done ANYTHING since it was sent — uploaded, answered, signed,
   * paid? This is what separates "we sent it" from "it is live", and it is the
   * honest stand-in until acceptance exists to draw that line properly.
   */
  clientHasEngaged: boolean;
  /**
   * Set once the accept step exists. Null means "this engagement predates
   * acceptance", which must read as un-accepted rather than as accepted —
   * defaulting the other way would silently mark every historical engagement as
   * agreed to by a client who was never asked.
   */
  acceptedAt?: string | null;
  /**
   * Whether this engagement ASKS the client to accept (1640).
   *
   * The line that makes `clientHasEngaged` safe again. That flag was written as
   * "the honest stand-in until acceptance exists to draw that line properly" —
   * and acceptance now exists, so on an engagement that asks for it the
   * stand-in has stopped being honest and started guessing over the top of a
   * real answer.
   *
   * False / absent means the engagement predates the accept step or never asks
   * for one, which is exactly the case the stand-in was written for and where
   * it still applies.
   */
  requiresAcceptance?: boolean;
  /**
   * When the firm said work could begin (1630).
   *
   * A SEPARATE decision from acceptance, which is Karbon's model too — their
   * Accepted state has an explicit "Activate" action "signalling that work can
   * begin". A signature is the client's act; starting is the firm's, and a
   * January-signed engagement should not look in-progress in January.
   *
   * When set it WINS over the client-activity guess below, because it is
   * somebody's actual decision rather than an inference from behaviour.
   */
  activatedAt?: string | null;
};

/**
 * Where the agreement is.
 *
 * Ordered most-final-first, because the later states are the more specific
 * claims and a completed engagement is completed regardless of what else is true.
 */
export function resolveAgreementStatus(f: AgreementFacts): AgreementStatus {
  if (f.status === "cancelled") return "cancelled";
  if (f.status === "complete" || f.completedAt != null) return "complete";

  // Never sent is a draft whatever else is set — an engagement can carry a full
  // scope, a price and a checklist and still be something nobody has seen.
  if (f.status === "draft" || f.sentAt == null) return "draft";

  // Accepted but not yet worked on. Distinct from active: the client has agreed
  // and nothing has happened since, which is a real and actionable state — it is
  // the firm's move, not the client's.
  if (f.acceptedAt != null) {
    // An explicit activation is the strongest signal there is — somebody
    // decided. Client activity remains a fallback for an engagement accepted
    // before Activate existed, or one where work simply started.
    if (f.activatedAt != null) return "active";
    return f.clientHasEngaged || f.status === "in_progress"
      ? "active"
      : "accepted";
  }

  // ── SENT, AND NOT ACCEPTED ────────────────────────────────────────────
  //
  // ⚠️ IF THE ENGAGEMENT ASKS FOR ACCEPTANCE, THIS IS WHERE IT STOPS.
  //
  // The founder, looking at a proposal the client had neither accepted nor
  // signed: "it says draft ✓ sent ✓ accepted ✓ ... It should not say accepted
  // because it has not been accepted. It was — it's just been sent, nor is it
  // active."
  //
  // Exactly right, and the rail ticks every step BEFORE the current one, so
  // returning "active" here silently claimed an acceptance that never
  // happened — on a contract. Two inferences were doing it:
  //
  //   `clientHasEngaged` — the client opening the proposal, or any activity at
  //     all, read as agreement. It was written as a stand-in "until acceptance
  //     exists"; acceptance exists now, so on these engagements it is guessing
  //     over the top of a real answer.
  //   `status === "in_progress"` — a lifecycle column, not a decision. 31 of 80
  //     engagements on production were sent-but-unaccepted and in_progress,
  //     every one of them drawing a tick it had not earned.
  //
  // Neither may speak for a client. Only `acceptedAt` can, and it is checked
  // above.
  if (f.requiresAcceptance) return "sent";

  // No acceptance asked for — a historical engagement, or one the firm never
  // required agreement on. Here the old stand-in is still the best available
  // reading, and there is no acceptance for it to overrule.
  //
  // `activatedAt` is deliberately NOT consulted: activating something nobody
  // agreed to is not a state the UI offers, and honouring a stray value would
  // let a bad write skip the agreement.
  return f.clientHasEngaged || f.status === "in_progress" ? "active" : "sent";
}

/**
 * How the work is doing — a COUNT, not a word.
 *
 * The whole point of the split. "3 of 6 done" cannot become misleading when a
 * seventh task starts, whereas any single adjective can. Returns null when there
 * is no work to describe, so a caller renders nothing rather than "0 of 0".
 */
export function workSummary(tasks: { done: boolean }[]): {
  done: number;
  total: number;
} | null {
  if (tasks.length === 0) return null;
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

/** Which statuses read as "this engagement is finished with". */
export function isClosed(s: AgreementStatus): boolean {
  return s === "complete" || s === "cancelled";
}

/**
 * Read the agreement status off a worklist row.
 *
 * A separate adapter rather than widening resolveAgreementStatus's input,
 * because the list's row shape is a display concern and the resolver is the
 * rule. It also documents the two derivations the list can make honestly
 * without a new query:
 *
 *  - `sentAt` — the list carries `startedAt`, which IS sent_at (falling back to
 *    created_at). A draft has not been sent whatever that column says, so the
 *    status gate comes first.
 *  - `clientHasEngaged` — the list already computes days since the client last
 *    did anything. A number means they have; null means they have not.
 */
export function agreementStatusForRow(row: {
  status: EngagementStatus;
  startedAt?: string | null;
  daysSinceClientActivity: number | null;
  acceptedAt?: string | null;
  requiresAcceptance?: boolean;
}): AgreementStatus {
  return resolveAgreementStatus({
    status: row.status,
    sentAt: row.status === "draft" ? null : (row.startedAt ?? null),
    completedAt: null,
    clientHasEngaged: row.daysSinceClientActivity != null,
    // ⚠️ THE LIST AND THE DETAIL PAGE MUST AGREE. These were missing, so a
    // row inferred agreement from client activity while the engagement's own
    // page (which does read them) said "sent" — the same job, two answers,
    // one of them claiming a contract had been accepted.
    acceptedAt: row.acceptedAt ?? null,
    requiresAcceptance: row.requiresAcceptance === true,
  });
}

/**
 * The i18n key (Engagements namespace) naming an agreement status.
 *
 * ⚠️ SHARED ON PURPOSE. It used to be private to AgreementChip, and the
 * engagements list's Status FILTER went on offering workflow stages
 * ("Awaiting payment", "Collecting documents") months after the COLUMN had
 * stopped showing them — so you could tick a value that appeared nowhere on
 * screen and get rows reading "Active". A column and its own menu must draw
 * their words from one place, or they drift the moment either is touched.
 */
export function agreementLabelKey(status: AgreementStatus): string {
  return `agr_${status}`;
}

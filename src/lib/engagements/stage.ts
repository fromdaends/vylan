// Engagement workflow STAGE — where an engagement actually is in the firm's
// process, replacing the generic "In progress" badge with real position.
//
// This module is PURE (types + one resolver + display config, no I/O) so the
// rules are provable in unit tests and every surface reads the same answer.
// The impure half — loading the facts, writing the column, appending history —
// lives in stage-sync.ts.
//
// Stage is a THIRD axis, orthogonal to the two that already exist:
//   * status (draft/sent/in_progress/complete/cancelled) — the lifecycle.
//   * archived_at / deleted_at (lifecycle.ts)            — the shelf.
//   * stage (here)                                       — the workflow.
// Lifecycle is untouched by any of this; stages exist INSIDE a live engagement.
//
// THE CENTRAL IDEA: resolveStage is a FURTHEST-ALONG-WINS cascade over facts,
// not a state machine over events. It asks "given what this engagement actually
// contains right now, how far along is it?" and returns the last stage the facts
// justify. Three things fall out of that shape for free:
//
//   1. Skip logic needs no special case. No signature items => the
//      awaiting_signature arm can never be true => the stage is skipped. No
//      invoice => awaiting_payment can never be true => skipped.
//   2. Stages can go BACKWARDS, which is correct. Reject a document after
//      starting preparation and the engagement honestly reads "collecting"
//      again — the client owes something. Auto always reflects reality.
//   3. A manual override is never sticky against the truth. The next event
//      re-resolves from facts, exactly as the spec requires.
//
// The ONE thing not derivable from facts is the "Start preparation" click (it
// leaves no other trace), so that's a stored latch fed in as preparationStarted.

import type { EngagementStatus } from "@/lib/db/engagements";
import { isAiBounced, type AttentionItem } from "@/lib/attention";

export const ENGAGEMENT_STAGES = [
  "collecting",
  "in_review",
  "in_preparation",
  "awaiting_signature",
  "awaiting_payment",
  "completed",
] as const;

export type EngagementStage = (typeof ENGAGEMENT_STAGES)[number];

export function isEngagementStage(v: unknown): v is EngagementStage {
  return (
    typeof v === "string" &&
    (ENGAGEMENT_STAGES as readonly string[]).includes(v)
  );
}

// Position in the canonical progression. Used for ordering the stepper and for
// "is this stage behind the current one" (=> render it as done).
export function stageIndex(stage: EngagementStage): number {
  return ENGAGEMENT_STAGES.indexOf(stage);
}

// One entry in engagements.stage_history. Append-only audit trail for future
// analytics (analytics itself is out of scope). triggered_by is the literal
// "auto" for an event-driven transition, or the user id for a manual override.
export type StageHistoryEntry = {
  stage: EngagementStage;
  at: string;
  triggered_by: "auto" | string;
};

// The history array can only grow, and an engagement that ping-pongs (upload,
// reject, re-upload) would grow it without bound. Keep the most recent slice —
// enough for the stepper's "date entered" tooltips and a long audit tail,
// bounded so a hot row's JSON stays small.
export const STAGE_HISTORY_LIMIT = 50;

export function appendStageHistory(
  history: StageHistoryEntry[],
  entry: StageHistoryEntry,
): StageHistoryEntry[] {
  const next = [...history, entry];
  return next.length > STAGE_HISTORY_LIMIT
    ? next.slice(next.length - STAGE_HISTORY_LIMIT)
    : next;
}

// Parse whatever came back from the jsonb column into typed entries, dropping
// anything malformed. The column is app-written, but it's jsonb — a bad row must
// degrade to "no history" (no tooltip), never throw into a page render.
export function parseStageHistory(raw: unknown): StageHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StageHistoryEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (!isEngagementStage(r.stage)) continue;
    if (typeof r.at !== "string") continue;
    const by = r.triggered_by;
    if (typeof by !== "string") continue;
    out.push({ stage: r.stage, at: r.at, triggered_by: by });
  }
  return out;
}

// The moment each stage was FIRST entered in the current pass, for the stepper's
// hover tooltip. Walks history forward and keeps the earliest entry per stage
// AFTER the last time the engagement was at (or before) that stage — i.e. a
// re-entered stage shows when it was most recently entered, not a stale first
// visit from three rejections ago.
export function stageEnteredAt(
  history: StageHistoryEntry[],
): Partial<Record<EngagementStage, string>> {
  const out: Partial<Record<EngagementStage, string>> = {};
  for (const entry of history) {
    // A transition to an EARLIER stage invalidates the recorded entry times of
    // everything at or after it — those stages will be entered again.
    for (const s of ENGAGEMENT_STAGES) {
      if (stageIndex(s) > stageIndex(entry.stage)) delete out[s];
    }
    out[entry.stage] = entry.at;
  }
  return out;
}

// ── Facts ───────────────────────────────────────────────────────────────────

// Everything the resolver needs to know about an engagement, already reduced to
// booleans and counts. Built by stage-sync.ts from the DB; built by hand in the
// tests. Deliberately NOT the raw rows — the resolver must not know how a
// signature or an invoice is stored.
export type StageFacts = {
  // The lifecycle column. draft / cancelled have no workflow position.
  status: EngagementStatus;

  // -- Checklist (collection items only; signature items are their own axis) --
  // Sized the way computeAttention sizes completion: required items are the
  // denominator, falling back to ALL collection items when nothing is required
  // (Custom templates). Without that fallback an all-optional engagement would
  // read "in review" the instant it was sent, since it has nothing "blocked".
  checklistTotal: number;
  // Items the client still owes something usable on: nothing uploaded yet, or a
  // rejected file awaiting its replacement. An AI-bounced item does NOT count —
  // a file exists and the accountant can override.
  checklistBlocked: number;
  // Items the accountant has cleared (approved) or excused (na).
  checklistApprovedOrNa: number;

  // -- Signing --
  // The engagement contains at least one signature item. FALSE means the whole
  // awaiting_signature stage is skipped for this engagement.
  hasSignatureItems: boolean;
  // At least one signature request row exists (the firm has acted on signing).
  hasSignatureRequests: boolean;
  // A signature is genuinely out with the client (pending / sent / viewed).
  // declined / canceled / expired / error are the FIRM's problem, not a wait on
  // the client, so they don't hold the engagement at awaiting_signature.
  hasOutstandingSignature: boolean;

  // -- Invoice --
  // An invoice exists at all. FALSE means awaiting_payment is skipped.
  hasInvoice: boolean;
  // An invoice is still owed (requested / failed). Paid and waived both clear.
  hasUnpaidInvoice: boolean;

  // -- Deliverables --
  // At least one final document exists (invoice attachments excluded).
  hasFinalDocuments: boolean;
  // ...AND the client can actually reach them: the deliverables lock is off.
  // (computeDeliverablesLocked — the same rule that gates the download route.)
  // This is what "released" means; an unpaid locking invoice makes it false.
  finalDocumentsReleased: boolean;

  // -- Explicit intent --
  // The "Start preparation" latch (preparation_started_at is set).
  preparationStarted: boolean;
};

// Has the firm visibly moved past collection? True on the explicit click, or on
// any act that only happens during preparation: every document cleared, a
// signature put out, a deliverable produced. Note an invoice does NOT count —
// migration 0610 lets an invoice be created at engagement CREATION time, long
// before any preparation.
//
// The preparationStarted arm deliberately OUTRANKS an outstanding checklist
// (arm 4 sits above arms 5/6 in the cascade). That's the entire purpose of
// "Start preparation": the accountant clicks it precisely because they don't
// want to wait for every last document. If one outstanding item pulled the stage
// back to collecting, the button would appear to do nothing in exactly the
// situation it exists for. The other arms carry no such declaration, so an
// engagement prepared only by having its checklist cleared DOES fall back to
// collecting when a document is sent back — nothing is left saying otherwise.
function preparationReached(f: StageFacts): boolean {
  return (
    f.preparationStarted ||
    f.hasSignatureRequests ||
    f.hasFinalDocuments ||
    (f.checklistTotal > 0 && f.checklistApprovedOrNa === f.checklistTotal)
  );
}

// The furthest-along stage these facts justify, or null when the engagement has
// no workflow position at all (draft: not sent yet; cancelled: abandoned).
//
// Read the arms top-down as "is it this far along? no? then is it this far?".
export function resolveStage(f: StageFacts): EngagementStage | null {
  if (f.status === "draft" || f.status === "cancelled") return null;

  // 1. Done: the finished work is in the client's hands and nothing is owed
  //    back. A locking unpaid invoice makes finalDocumentsReleased false on its
  //    own, so the two conditions can't disagree.
  if (
    f.finalDocumentsReleased &&
    !f.hasOutstandingSignature &&
    !f.hasUnpaidInvoice
  ) {
    return "completed";
  }

  // 2. Money owed, signing done or never needed. Gated on preparation so an
  //    invoice raised at engagement creation (0610) can't jump a brand-new
  //    engagement straight to "awaiting payment" while docs are still coming in.
  if (f.hasUnpaidInvoice && !f.hasOutstandingSignature && preparationReached(f)) {
    return "awaiting_payment";
  }

  // 3. A signature is out with the client.
  if (f.hasOutstandingSignature) return "awaiting_signature";

  // 4. The firm is doing the work. Also where a finished-signing engagement
  //    lands when there's no invoice and no deliverable yet ("else stay in
  //    preparation").
  if (preparationReached(f)) return "in_preparation";

  // 5. Everything the client owed is in; the accountant hasn't cleared it all.
  if (f.checklistTotal > 0 && f.checklistBlocked === 0) return "in_review";

  // 6. Still waiting on the client. Also the honest answer for an engagement
  //    with no checklist at all that hasn't been acted on.
  return "collecting";
}

// Which stages this engagement's stepper shows — the skip logic, made visible.
// An engagement with no signature items never shows awaiting_signature; one with
// no invoice never shows awaiting_payment.
//
// `current` is always included even when the facts say it wouldn't apply: a
// manual override can park an engagement at a stage it doesn't structurally
// have, and the stepper must still be able to draw the node it's standing on.
//
// Takes only the two facts it actually reads (a full StageFacts satisfies it),
// so a caller that just wants to draw a stepper doesn't have to assemble the
// whole fact set — the engagement detail page already knows its items and its
// invoice, and that's all this needs.
export function applicableStages(
  f: Pick<StageFacts, "hasSignatureItems" | "hasInvoice">,
  current?: EngagementStage | null,
): EngagementStage[] {
  return ENGAGEMENT_STAGES.filter((s) => {
    if (s === current) return true;
    if (s === "awaiting_signature") return f.hasSignatureItems;
    if (s === "awaiting_payment") return f.hasInvoice;
    return true;
  });
}

// ── Checklist reduction ─────────────────────────────────────────────────────

// The slice of a request_item the checklist facts read. Structural, so a full
// RequestItem satisfies it. AttentionItem carries status + rejection_reason (the
// AI-bounce rule); the stage adds kind (signatures are a separate axis) and
// required (the denominator).
export type StageChecklistItem = AttentionItem & {
  kind: "collection" | "signature";
  required: boolean;
};

// Reduce an engagement's items to the three checklist numbers in StageFacts.
// Mirrors computeAttention's denominator rule exactly (required items, falling
// back to all when none are required) so the stage chip and the progress bar
// can never tell different stories about the same engagement.
export function checklistFacts(items: StageChecklistItem[]): {
  checklistTotal: number;
  checklistBlocked: number;
  checklistApprovedOrNa: number;
} {
  const collection = items.filter((i) => i.kind === "collection");
  const required = collection.filter((i) => i.required);
  const denom = required.length > 0 ? required : collection;
  return {
    checklistTotal: denom.length,
    checklistBlocked: denom.filter(
      (i) =>
        (i.status === "pending" && !isAiBounced(i)) || i.status === "rejected",
    ).length,
    checklistApprovedOrNa: denom.filter(
      (i) => i.status === "approved" || i.status === "na",
    ).length,
  };
}

// ── Display ─────────────────────────────────────────────────────────────────

// i18n key for a stage's firm-facing label, under the "Stage" namespace.
export function stageLabelKey(stage: EngagementStage): string {
  return `stage_${stage}`;
}

// i18n key for the client-facing wording shown in the portal, under "Portal".
// Deliberately different copy: the client shouldn't read the firm's internal
// process names ("In preparation"), they should read what it means for them
// ("Your accountant is working on your file").
//
// awaiting_payment has NO client-facing line of its own, by design: the portal's
// invoice card already makes the ask, and repeating "we're waiting for your
// money" as a status line would be both redundant and cold. From the client's
// side the honest reading of that stage is that their file is still in the
// firm's hands, so it borrows the in_preparation wording.
export function portalStageLabelKey(stage: EngagementStage): string {
  const key = stage === "awaiting_payment" ? "in_preparation" : stage;
  return `stage_${key}`;
}

// Chip tint per stage. Follows the existing chip convention (subtle background
// tint + colored text + transparent border, never a heavy fill) and reads on
// both themes via the --stage-* tokens in globals.css, which are tuned per
// theme the same way the --icon-* hues are.
export const STAGE_CHIP_CLASS: Record<EngagementStage, string> = {
  collecting: "bg-stage-collecting/15 text-stage-collecting",
  in_review: "bg-stage-review/15 text-stage-review",
  in_preparation: "bg-stage-preparation/15 text-stage-preparation",
  awaiting_signature: "bg-stage-signature/15 text-stage-signature",
  awaiting_payment: "bg-stage-payment/15 text-stage-payment",
  completed: "bg-stage-completed/15 text-stage-completed",
};

// Solid token per stage, for the stepper's nodes + connecting line (which need
// the color itself, not a tint).
export const STAGE_TEXT_CLASS: Record<EngagementStage, string> = {
  collecting: "text-stage-collecting",
  in_review: "text-stage-review",
  in_preparation: "text-stage-preparation",
  awaiting_signature: "text-stage-signature",
  awaiting_payment: "text-stage-payment",
  completed: "text-stage-completed",
};

export const STAGE_BG_CLASS: Record<EngagementStage, string> = {
  collecting: "bg-stage-collecting",
  in_review: "bg-stage-review",
  in_preparation: "bg-stage-preparation",
  awaiting_signature: "bg-stage-signature",
  awaiting_payment: "bg-stage-payment",
  completed: "bg-stage-completed",
};

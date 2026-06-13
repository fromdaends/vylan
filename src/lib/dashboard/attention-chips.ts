import type { WorklistRow } from "@/components/dashboard/engagements-worklist";

// Needs-attention chip calmer — decides, per row, which ONE reason wears the
// colored accent chip and which reasons render as quiet muted text. Display
// logic only: which engagements qualify, their order, and the underlying
// signals all stay with lib/attention + worklist-select (no private math).
//
// The rules (founder brief, 2026-06):
// - At most one colored element per row. Accent priority: a missed deadline
//   out-shouts everything, then the founder's actionable order (ready >
//   flagged > signed copy), then "due soon" as the weakest colored fallback.
// - "Waiting # days" (uploads sitting in the ACCOUNTANT's review queue) and
//   "Quiet for # days" (no client activity) are passive context: muted text,
//   never the accent.
// - Dedupe: when something is sitting unreviewed, "Quiet" is redundant — the
//   waiting clock starts at the oldest undecided upload, so whenever both
//   exist Waiting is always the older/larger number. Show only Waiting.

export type AttentionReason =
  | "overdue"
  | "sitting"
  | "flagged"
  | "signed_copy"
  | "ready"
  | "due_soon"
  | "stale";

// The slice of a worklist row the chip decision reads.
export type AttentionChipFacts = Pick<
  WorklistRow,
  | "reasons"
  | "sittingUnreviewed"
  | "flaggedFilesCount"
  | "signedCopiesToConfirm"
  | "readyToReview"
>;

export type AttentionChips = {
  // The single reason that wears the colored chip (null when only passive
  // context applies — a purely "waiting/quiet" row has no colored element).
  accent: AttentionReason | null;
  // Everything else that applies, in display order, rendered as muted text.
  context: AttentionReason[];
};

// Who may wear the color, strongest first.
const ACCENT_PRIORITY: readonly AttentionReason[] = [
  "overdue",
  "ready",
  "flagged",
  "signed_copy",
  "due_soon",
];

// Display order for the muted tier — same order the chips used to render in,
// so the row reads the same left-to-right as before, just quieter.
const CONTEXT_ORDER: readonly AttentionReason[] = [
  "overdue",
  "sitting",
  "flagged",
  "signed_copy",
  "ready",
  "due_soon",
  "stale",
];

export function pickAttentionChips(row: AttentionChipFacts): AttentionChips {
  const present = new Set<AttentionReason>();
  if (row.reasons.includes("overdue")) present.add("overdue");
  if (row.sittingUnreviewed) present.add("sitting");
  if (row.flaggedFilesCount > 0) present.add("flagged");
  if (row.signedCopiesToConfirm > 0) present.add("signed_copy");
  if (row.readyToReview) present.add("ready");
  if (row.reasons.includes("due_soon")) present.add("due_soon");
  if (row.reasons.includes("stale")) present.add("stale");

  // Waiting beats Quiet (see header comment).
  if (present.has("sitting")) present.delete("stale");

  const accent = ACCENT_PRIORITY.find((r) => present.has(r)) ?? null;
  const context = CONTEXT_ORDER.filter((r) => present.has(r) && r !== accent);
  return { accent, context };
}

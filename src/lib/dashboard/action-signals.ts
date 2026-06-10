import type { UploadedFile } from "@/lib/db/uploaded-files";
import type { RequestItem } from "@/lib/db/request-items";

// Needs attention 2.0 — the per-engagement "the ACCOUNTANT must act" signals
// that the checklist-item roll-up (lib/attention) can't see because they live
// on the FILES: flagged uploads awaiting a call, returned signed copies
// awaiting confirmation, and how long undecided submissions have been waiting.
// Pure + unit-tested; the worklist loader feeds it the same uploaded_files
// rows it already fetches per engagement.

const DAY_MS = 24 * 60 * 60 * 1000;

// "Sitting unreviewed" threshold: a submission awaiting an accountant decision
// for MORE than this many days raises the chip. Decision default from the
// autorun brief; adjust here if the founder wants a different patience window.
export const SITTING_UNREVIEWED_DAYS = 3;

// The slice of an uploaded_files row the signals need. UploadedFile satisfies
// this structurally, and the worklist's lighter select can match it too.
export type SignalFile = Pick<
  UploadedFile,
  | "request_item_id"
  | "uploaded_at"
  | "review_status"
  | "ai_rejected"
  | "ai_usability"
  | "is_duplicate"
  | "reviewed_by"
>;

export type ActionSignals = {
  // Uploads the AI flagged (unusable read, or escalated after repeat strikes)
  // or auto-rejected, where the accountant has NOT yet made their own call.
  // Auto-rejected files only count while they're still the latest upload on
  // their item — once the client re-sends, the old bounce no longer needs a
  // human call.
  flaggedFiles: number;
  // Signature items where the client returned a signed copy and the
  // accountant hasn't confirmed it yet.
  signedCopiesToConfirm: number;
  // The oldest upload still awaiting an accountant decision (ISO), and how
  // many whole days it has been waiting. Null when nothing is undecided.
  waitingSince: string | null;
  waitingDays: number | null;
  // True when the oldest undecided submission has waited MORE than
  // SITTING_UNREVIEWED_DAYS days.
  sittingUnreviewed: boolean;
};

export function computeActionSignals(
  files: SignalFile[],
  items: Pick<RequestItem, "id" | "kind">[],
  now: Date = new Date(),
): ActionSignals {
  // Duplicates are set aside everywhere (preview, item roll-up) — they never
  // demand an accountant decision, so they never raise a signal either.
  const real = files.filter((f) => !f.is_duplicate);
  const pending = real.filter((f) => f.review_status === "pending");

  // Latest upload per checklist item, to tell an OUTSTANDING auto-reject (the
  // client hasn't replaced it; the accountant may want to override) from a
  // superseded one (a newer upload exists; the bounce resolved itself).
  const latestByItem = new Map<string, string>();
  for (const f of real) {
    const prev = latestByItem.get(f.request_item_id);
    if (!prev || f.uploaded_at > prev) {
      latestByItem.set(f.request_item_id, f.uploaded_at);
    }
  }

  const aiConcern = (f: SignalFile) =>
    f.ai_rejected || f.ai_usability?.usable === false;
  const flaggedPending = pending.filter(aiConcern).length;
  const autoRejectedOutstanding = real.filter(
    (f) =>
      f.review_status === "rejected" &&
      f.ai_rejected &&
      f.reviewed_by === null && // system bounce, no accountant involved yet
      latestByItem.get(f.request_item_id) === f.uploaded_at,
  ).length;

  const signatureItemIds = new Set(
    items.filter((i) => i.kind === "signature").map((i) => i.id),
  );
  const signatureItemsAwaiting = new Set(
    pending
      .filter((f) => signatureItemIds.has(f.request_item_id))
      .map((f) => f.request_item_id),
  );

  let waitingSince: string | null = null;
  for (const f of pending) {
    if (!waitingSince || f.uploaded_at < waitingSince) {
      waitingSince = f.uploaded_at;
    }
  }
  const waitingMs = waitingSince
    ? now.getTime() - new Date(waitingSince).getTime()
    : null;
  const waitingDays = waitingMs != null ? Math.floor(waitingMs / DAY_MS) : null;

  return {
    flaggedFiles: flaggedPending + autoRejectedOutstanding,
    signedCopiesToConfirm: signatureItemsAwaiting.size,
    waitingSince,
    waitingDays,
    sittingUnreviewed:
      waitingMs != null && waitingMs > SITTING_UNREVIEWED_DAYS * DAY_MS,
  };
}

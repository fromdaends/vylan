// A handoff note is the short message an accountant can leave when they reassign
// an engagement to a teammate ("vehicle log still missing, meals capped at 50%").
// It rides along on the engagement_reassigned activity metadata and surfaces in
// the assignee's "assigned to you" notification.

export const HANDOFF_NOTE_MAX = 500;

// Trim, treat blank as "no note" (null) so we never persist an empty string, and
// cap length defensively (a note is a sentence, not an essay). Pure + testable.
export function normalizeHandoffNote(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, HANDOFF_NOTE_MAX);
}

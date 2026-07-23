// Team Wave 3 — @mention helpers (pure). The comment composer tracks the ids of
// members it inserted via the @ picker; the server sanitizes that list against
// the firm's real members before storing/notifying, so a tampered client can't
// mention a non-member or the author themselves.

// Keep only the ids that are: real firm members, not the author, de-duplicated.
// Order-preserving. Caps the count so a comment can't fan out absurdly.
const MAX_MENTIONS = 20;

export function sanitizeMentions(
  ids: readonly string[],
  validMemberIds: ReadonlySet<string>,
  authorId: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (id === authorId) continue;
    if (!validMemberIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

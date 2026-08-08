// Finding the @mentions inside a comment body — pure, so it can be argued with
// in a test rather than in production.
//
// ── WHY THIS HAS TO MATCH ON NAMES ─────────────────────────────────────────
//
// The composer splices a member's DISPLAY NAME into the textarea as literal
// text ("@Marie Fortin ") and sends the ids alongside, in the row's `mentions`
// array. The body itself carries no id token and no positions. So the renderer
// gets two halves — the text, and who was meant — and has to marry them back up
// by name.
//
// LONGEST NAME FIRST is the whole trick: with "Sam" and "Samantha" both on the
// roster, matching "Sam" first would eat the first three letters of Samantha's
// mention and paint the rest as plain text. Sorting by descending length means
// the most specific name always wins its span.
//
// AND THE BOUNDARY: a match only counts when the character after the name is
// not a word character, so "@Sam" does not light up inside "@Sammy". This is
// the same rule the composer applies in reverse when it decides which picked
// members actually survived into the body (comment-thread-core's submit).
//
// ONLY REAL MENTIONS ARE PAINTED. A member is eligible when their id is in the
// row's `mentions` array — the ids the server sanitized at write time. Someone
// typing "@Marie" by hand without picking her from the menu gets no colour,
// which is honest: she was never notified either.

export type MentionMember = { id: string; name: string };

export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; userId: string };

/**
 * Split a comment body into plain-text and mention segments.
 *
 * @param body      the comment as typed
 * @param members   the firm roster available to the renderer
 * @param mentioned the ids the row actually recorded; when omitted every roster
 *                  member is eligible (used where a surface has no id array)
 */
export function splitBodyMentions(
  body: string,
  members: readonly MentionMember[],
  mentioned?: readonly string[],
): BodySegment[] {
  if (!body) return [];
  const eligible = (
    mentioned == null
      ? [...members]
      : members.filter((m) => mentioned.includes(m.id))
  )
    .filter((m) => m.name.trim().length > 0)
    // Longest first — see the header.
    .sort((a, b) => b.name.length - a.name.length);
  if (eligible.length === 0) return [{ kind: "text", text: body }];

  const segments: BodySegment[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) {
      segments.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (i < body.length) {
    if (body[i] === "@") {
      const rest = body.slice(i + 1);
      const hit = eligible.find((m) => {
        if (!rest.startsWith(m.name)) return false;
        const after = rest.charAt(m.name.length);
        // End of string, or a non-word character, is a clean boundary.
        return after === "" || !/[\p{L}\p{N}_]/u.test(after);
      });
      if (hit) {
        flush();
        segments.push({
          kind: "mention",
          text: `@${hit.name}`,
          userId: hit.id,
        });
        i += 1 + hit.name.length;
        continue;
      }
    }
    buffer += body[i];
    i += 1;
  }
  flush();
  return segments;
}

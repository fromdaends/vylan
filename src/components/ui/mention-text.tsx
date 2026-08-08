// A comment body with its @mentions in each teammate's own colour.
//
// ONE component for every surface that shows a mention, so "what does a mention
// look like" has a single answer — the founder's ask was explicitly
// software-wide ("across the entire software… every member on the team has a
// distinct colour"). Today its one consumer is the shared CommentList, which is
// itself the only mention renderer in the app; anything that grows mentions
// later (team chat has none yet) renders them by using this, never by writing
// its own span.
//
// Plain text otherwise: whitespace is preserved by the caller's class, and the
// segments carry no HTML, so nothing here can inject markup from a comment.

import { cn } from "@/lib/cn";
import { memberTextClass } from "@/lib/members/color";
import { splitBodyMentions, type MentionMember } from "@/lib/members/mentions";

export function MentionText({
  body,
  members,
  mentioned,
  className,
}: {
  body: string;
  members: readonly MentionMember[];
  /** The ids the row recorded. Omit to treat every roster name as mentionable. */
  mentioned?: readonly string[];
  className?: string;
}) {
  const segments = splitBodyMentions(body, members, mentioned);
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.kind === "mention" ? (
          <span
            key={i}
            className={cn("font-medium", memberTextClass(seg.userId))}
            // The name is already visible; the title repeats it for a reader
            // who cannot resolve the colour (and for anyone colour-blind, the
            // weight change carries the same signal).
            title={seg.text.slice(1)}
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}

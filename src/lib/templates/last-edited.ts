// "Template last edited on 10/16/2025 by me" — Canopy's one line under every
// template name, which the founder sent a screenshot of and asked for.
//
// Pure, so the date and the three name cases can be tested without rendering
// anything. The caller supplies its own translator and `now` is never read from
// the clock here.

export type LastEditedInput = {
  /** ISO timestamp from the row's `updated_at` (migration 1600). */
  updatedAt: string | null;
  /** Who did it. Null when the write did not record anyone. */
  updatedByUserId: string | null;
  /** Who is looking, so their own edits read "by me" as Canopy's do. */
  viewerUserId: string | null;
  /** Firm members by id, for everyone else's name. */
  nameById: Map<string, string>;
};

/**
 * The line, or null when there is nothing honest to say.
 *
 * Null rather than a fallback string: a template whose `updated_at` did not
 * come back should show NO line, not "Last edited —". An empty slot reads as
 * "we do not track that"; a broken one reads as a bug.
 */
export function lastEditedLine(
  input: LastEditedInput,
  t: (key: string, values?: Record<string, string>) => string,
  locale: "en" | "fr",
): string | null {
  if (!input.updatedAt) return null;

  const parsed = new Date(input.updatedAt);
  // An unparseable timestamp is worse than no timestamp: "Invalid Date" on a
  // list is alarming and tells nobody anything.
  if (Number.isNaN(parsed.getTime())) return null;

  const date = new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-CA", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(parsed);

  // Three cases, in the order they are most likely: it was me, it was a
  // teammate, or nobody was recorded.
  if (input.updatedByUserId && input.updatedByUserId === input.viewerUserId) {
    return t("last_edited_by_me", { date });
  }
  const name = input.updatedByUserId
    ? input.nameById.get(input.updatedByUserId)
    : undefined;
  // A recorded id we cannot name — a deactivated teammate, say — falls back to
  // the plain date rather than printing a raw uuid at somebody.
  if (name) return t("last_edited_by", { date, name });
  return t("last_edited", { date });
}

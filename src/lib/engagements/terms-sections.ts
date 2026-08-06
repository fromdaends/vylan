// Terms, as labelled sections rather than one box.
//
// ── WHAT THE FOUNDER ASKED FOR ─────────────────────────────────────────────
//
// "I didn't want a rich text editor. I meant more like you can have multiple
// sections for the terms. Like you can create boxes and label them differently.
// So there's different sections to the terms, which eventually we should make a
// terms template that you can just drop in."
//
// So: a list of {heading, body}. No editor, no HTML, no change to what gets
// stored beyond going from one string to several named ones — which also gives
// the droppable "terms template" somewhere obvious to live later, since a
// template is then just a saved list of these.
//
// ── EVERY OLD PROPOSAL STILL READS ─────────────────────────────────────────
//
// Terms used to be a single `termsText` string, and there are engagements and
// templates carrying one right now — including contracts clients have already
// agreed to. Those must keep rendering exactly as they did, so a legacy string
// upgrades into ONE untitled section rather than being dropped or wrapped in an
// invented heading. Nobody's signed terms gain a title they never had.

export type TermsSection = {
  /** What this part is called — "Scope", "Fees", "Termination". May be empty:
   *  a section with only a body is the shape every legacy value takes. */
  heading: string;
  body: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * Read terms from anything: a list of sections, a legacy string, or nonsense.
 *
 * TOTAL — this runs on the path that renders a client's contract from a jsonb
 * snapshot written by an older build, so it can never throw.
 */
export function readTermsSections(raw: unknown): TermsSection[] {
  // The legacy shape. One untitled section, so it renders byte-identically.
  if (typeof raw === "string") {
    const body = raw.trim();
    return body.length > 0 ? [{ heading: "", body }] : [];
  }

  if (!Array.isArray(raw)) return [];

  return raw
    .map((x) => {
      if (typeof x === "string") {
        const body = x.trim();
        return body.length > 0 ? { heading: "", body } : null;
      }
      if (x == null || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const heading = str(o.heading).trim().slice(0, 200);
      const body = str(o.body).trim();
      // A section with a heading and nothing under it is a title promising
      // terms that are not there — worse on a contract than no section at all.
      if (body.length === 0) return null;
      return { heading, body };
    })
    .filter((x): x is TermsSection => x != null)
    .slice(0, 30);
}

/** Is there anything a client would read? */
export function hasTerms(sections: readonly TermsSection[]): boolean {
  return sections.some((s) => s.body.trim().length > 0);
}

/**
 * Flatten to plain text, for surfaces that still take one string (an email
 * body, a PDF paragraph, a search index).
 *
 * Headings are kept and separated by blank lines so the structure survives
 * where it can, and a section with no heading contributes only its body.
 */
export function termsToPlainText(sections: readonly TermsSection[]): string {
  return sections
    .filter((s) => s.body.trim().length > 0)
    .map((s) =>
      s.heading.trim().length > 0
        ? `${s.heading.trim()}\n${s.body.trim()}`
        : s.body.trim(),
    )
    .join("\n\n");
}

export function emptyTermsSection(): TermsSection {
  return { heading: "", body: "" };
}

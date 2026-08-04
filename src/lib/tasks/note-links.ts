// Pulling the links out of a task's note.
//
// The reason this exists is the answer to a question the founder asked about
// Canopy and Karbon: in both products, an ordinary task performs NOTHING. It is
// a checkbox somebody ticks after doing the work in a different program. The
// tax return is prepared in tax software; the books are done in QuickBooks.
//
// Karbon's own docs are explicit about how they bridge that gap — a task
// description takes "hyperlinks... to jump from Karbon to other applications".
// That is the whole mechanism, and it is cheap: the task says what to do and
// carries the doorway to wherever it is actually done.
//
// So Vylan's note field grows the same power, without becoming a rich-text
// editor. You type a note; any URL in it becomes something you can click.
//
// ── WHY A SEPARATE LIST AND NOT LINKIFIED TEXT ─────────────────────────────
//
// The note stays a plain textarea you can select, edit and paste into. Turning
// it into rendered HTML would mean an edit mode and a view mode, and a
// contenteditable to make that not feel broken — a lot of surface for the sake
// of one link. Listing the links underneath keeps the field exactly as it is
// and still gives you the doorway.
//
// ⚠️ http and https ONLY. A note is free text a person typed; anything else in
// an href is a way to make a click do something the writer did not intend, and
// `javascript:` is the obvious one. The scheme allowlist is the guard, not a
// blocklist of the tricks people know about today.

/** A bare URL in free text. Stops at whitespace, then trailing punctuation is
 *  trimmed below — "see https://x.com/a." should not link the full stop. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;

/** Characters that end a sentence rather than a URL. */
const TRAILING = /[.,;:!?)\]}>'"]+$/;

export type NoteLink = {
  /** The href, already checked to be http or https. */
  href: string;
  /** Host and path, shortened — a raw URL is unreadable in a narrow panel. */
  label: string;
};

function isSafe(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** "app.taxcycle.com/returns/2026" from a long url, capped so it cannot push
 *  the panel wide. */
function shorten(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = url.host.replace(/^www\./, "");
  const rest = `${url.pathname}${url.search}`.replace(/\/$/, "");
  const label = rest && rest !== "/" ? `${host}${rest}` : host;
  return label.length > 48 ? `${label.slice(0, 47)}…` : label;
}

/**
 * Every link in a note, in the order they were written, without repeats.
 *
 * Order matters: somebody who put the return first and the working papers
 * second meant that, and re-sorting would quietly rearrange their intent.
 */
export function noteLinks(note: string | null | undefined): NoteLink[] {
  if (!note) return [];
  const out: NoteLink[] = [];
  const seen = new Set<string>();
  for (const match of note.matchAll(URL_IN_TEXT)) {
    const href = match[0].replace(TRAILING, "");
    if (!href || seen.has(href) || !isSafe(href)) continue;
    seen.add(href);
    out.push({ href, label: shorten(href) });
  }
  return out;
}

// A tiny, safe markdown parser for the assistant's replies.
//
// The engagement chat used to render PLAIN TEXT ONLY (every markdown marker
// stripped). It now lets the model use LIGHT formatting — bold for emphasis,
// bullet and numbered lists — so replies read like a normal assistant. This
// parser turns the model's text into a small block/span tree; the chat tab
// renders that tree as React elements, so nothing is ever injected as HTML
// (no dangerouslySetInnerHTML) and the output is XSS-safe by construction.
//
// Deliberately NOT a full markdown engine: headings, tables, images,
// blockquotes, and code fences are stripped or ignored (the prompt forbids
// them). Only inline **bold**, *italic* / _italic_, `code`, INTERNAL links,
// and "- " / "1. " lists are understood. Unclosed markers mid-stream simply
// render literally until the closing marker arrives.
//
// LINKS are deliberately internal-only (Files v2 §4 citations): [text](href)
// becomes a link ONLY when href starts with a single "/" — no protocol, no
// host, no "//", which rules out javascript:, data:, and every external URL
// by construction. Anything else renders as its plain label text.

export type MarkdownSpan =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

export type MarkdownBlock =
  | { type: "paragraph"; lines: MarkdownSpan[][] }
  | { type: "bullets"; items: MarkdownSpan[][] }
  | { type: "numbered"; items: MarkdownSpan[][] };

// Links are tried first (their brackets must not be chewed by emphasis),
// then bold before single-asterisk italic; code is opaque (its contents are
// never re-parsed). Italic underscores only bind between non-word boundaries
// so snake_case identifiers survive intact. Numbered groups (not named) to
// stay within the project's compile target:
//   1 = [label   2 = ](href)   3 = **bold**   4 = `code`   5 = *italic*   6 = _italic_
const INLINE_RE =
  /\[([^\]\n]+?)\]\(([^)\s]+?)\)|\*\*([^\n]+?)\*\*|`([^`\n]+?)`|\*([^*\n]+?)\*|(?<!\w)_([^_\n]+?)_(?!\w)/g;

/** Internal app path: one leading slash, never "//", never a protocol. */
const SAFE_INTERNAL_HREF = /^\/(?!\/)[^\s]*$/;

export function parseInlineSpans(text: string): MarkdownSpan[] {
  const spans: MarkdownSpan[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) {
      spans.push({ type: "text", value: text.slice(last, m.index) });
    }
    if (m[1] !== undefined) {
      const href = m[2] ?? "";
      if (SAFE_INTERNAL_HREF.test(href)) {
        spans.push({ type: "link", value: m[1], href });
      } else {
        // External or malformed target: keep the words, drop the link.
        spans.push({ type: "text", value: m[1] });
      }
    } else if (m[3] !== undefined) spans.push({ type: "bold", value: m[3] });
    else if (m[4] !== undefined) spans.push({ type: "code", value: m[4] });
    else spans.push({ type: "italic", value: (m[5] ?? m[6]) as string });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    spans.push({ type: "text", value: text.slice(last) });
  }
  return spans.length > 0 ? spans : [{ type: "text", value: text }];
}

// Strip the markdown constructs the panel never renders, so a model slip
// doesn't leave raw "###" or "---" on screen.
function normalize(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n");
  // Leading heading hashes -> keep the title text, drop the marker.
  t = t.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  // Horizontal rules (--- / *** / ___) -> drop the whole line.
  t = t.replace(/^[ \t]*([-*_])\1{2,}[ \t]*$/gm, "");
  // Blockquote markers -> drop the leading ">".
  t = t.replace(/^[ \t]*>[ \t]?/gm, "");
  // Collapse 3+ blank lines to a single paragraph break.
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

const BULLET_RE = /^[ \t]*[-*•][ \t]+(.*)$/;
const NUMBERED_RE = /^[ \t]*\d+[.)][ \t]+(.*)$/;

export function parseAssistantMarkdown(raw: string): MarkdownBlock[] {
  const lines = normalize(raw).split("\n");
  const blocks: MarkdownBlock[] = [];

  let para: MarkdownSpan[][] = [];
  let bullets: MarkdownSpan[][] = [];
  let numbered: MarkdownSpan[][] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "paragraph", lines: para });
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push({ type: "bullets", items: bullets });
      bullets = [];
    }
  };
  const flushNumbered = () => {
    if (numbered.length) {
      blocks.push({ type: "numbered", items: numbered });
      numbered = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/, "");
    if (line.trim() === "") {
      // Blank line ends whatever group is open.
      flushPara();
      flushBullets();
      flushNumbered();
      continue;
    }
    const bulletM = line.match(BULLET_RE);
    if (bulletM) {
      flushPara();
      flushNumbered();
      bullets.push(parseInlineSpans(bulletM[1]));
      continue;
    }
    const numM = line.match(NUMBERED_RE);
    if (numM) {
      flushPara();
      flushBullets();
      numbered.push(parseInlineSpans(numM[1]));
      continue;
    }
    // A plain line: joins the current paragraph (consecutive plain lines stay
    // one paragraph, rendered with soft line breaks, as the old panel did).
    flushBullets();
    flushNumbered();
    para.push(parseInlineSpans(line.trim()));
  }

  flushPara();
  flushBullets();
  flushNumbered();
  return blocks;
}

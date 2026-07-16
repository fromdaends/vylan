// The shape of a help center article.
//
// WHY TYPED CONTENT INSTEAD OF MDX OR A DB TABLE (founder decision, 2026-07-16):
//   * messages/{en,fr}.json is the worst place for this. It's already 2400+
//     keys, it's the file two parallel sessions fight over most, and long-form
//     prose in flat key/value pairs has nowhere to put a heading or a list.
//   * MDX would mean two new dependencies, a next.config change, and a build
//     step to extract searchable plain text out of compiled components.
//   * A DB table would keep the content out of pull requests, and every word
//     here is public and gets founder review before it ships.
//
// The real win: content is DATA. Search falls out for free (the text is
// already a string, see plainText below), and the registry can prove at build
// time that every English article has a French twin.
//
// Authoring uses the helpers at the bottom, so an article reads close to prose:
//
//   body: [
//     p("Vylan checks every document your client uploads."),
//     h("What the check looks for"),
//     steps(
//       ["Open ", ui("Settings"), "."],
//       ["Turn on ", ui("Auto-reject unusable documents"), "."],
//     ),
//   ]

// ---------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------

export type Inline =
  | string
  // A label the reader should hunt for on screen (a button, a menu item, a
  // setting). Rendered as a subtle chip so it's scannable — the same job the
  // in-app assistant does with double quotes, but legible at article length.
  | { t: "ui"; text: string }
  | { t: "strong"; text: string }
  // href is either an in-app/marketing path ("/help/engagements/stages") or an
  // absolute URL. The renderer decides which; authors just give a path.
  | { t: "link"; href: string; text: string };

export const ui = (text: string): Inline => ({ t: "ui", text });
export const strong = (text: string): Inline => ({ t: "strong", text });
export const link = (href: string, text: string): Inline => ({
  t: "link",
  href,
  text,
});

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type HelpBlock =
  | { kind: "p"; text: Inline[] }
  // A section heading inside an article. These are also what the on-page
  // "in this article" jump list is built from, and they're searchable.
  | { kind: "h"; text: string }
  | { kind: "steps"; items: Inline[][] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "note"; text: Inline[] }
  | { kind: "warn"; text: Inline[] };

export const p = (...text: Inline[]): HelpBlock => ({ kind: "p", text });
export const h = (text: string): HelpBlock => ({ kind: "h", text });
export const steps = (...items: Inline[][]): HelpBlock => ({
  kind: "steps",
  items,
});
export const list = (...items: Inline[][]): HelpBlock => ({
  kind: "list",
  items,
});
export const note = (...text: Inline[]): HelpBlock => ({ kind: "note", text });
export const warn = (...text: Inline[]): HelpBlock => ({ kind: "warn", text });

// ---------------------------------------------------------------------------
// Articles + categories
// ---------------------------------------------------------------------------

export type HelpArticle = {
  // Shown as the <h1> and as the search result title.
  title: string;
  // One or two sentences. Doubles as the page's meta description and the
  // search result snippet, so it has to stand alone.
  summary: string;
  // Extra search terms that don't belong in the prose: words a reader would
  // actually type ("blurry", "rejected", "2fa") when the article calls it
  // something more formal. Never rendered.
  keywords: string[];
  body: HelpBlock[];
};

export type HelpCategoryMeta = {
  title: string;
  // Sits under the category title on the index card and the category page.
  description: string;
};

// ---------------------------------------------------------------------------
// Plain text extraction (the whole reason content is data)
// ---------------------------------------------------------------------------

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (typeof n === "string" ? n : n.text))
    .join("")
    .trim();
}

export function blockText(block: HelpBlock): string {
  switch (block.kind) {
    case "p":
    case "note":
    case "warn":
      return inlineText(block.text);
    case "h":
      return block.text;
    case "steps":
    case "list":
      return block.items.map(inlineText).join(" ");
  }
}

// Everything a reader could reasonably search for, as one folded-later string.
export function articleText(article: HelpArticle): string {
  return [
    article.title,
    article.summary,
    article.keywords.join(" "),
    article.body.map(blockText).join(" "),
  ].join(" ");
}

// The headings of an article, in order — used for the "in this article" jump
// list on long pages.
export function articleHeadings(article: HelpArticle): string[] {
  return article.body.filter((b) => b.kind === "h").map((b) => b.text);
}

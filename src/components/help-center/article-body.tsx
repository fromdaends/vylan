// Renders a HelpArticle's typed blocks to HTML.
//
// This is the whole payoff of storing content as data instead of MDX: the
// renderer is one switch, there's no compile step, and the same block array
// that produces this markup also produces the plain text the search index is
// built from — so an article can never be findable but unreadable, or the
// reverse.

import { Link } from "@/i18n/navigation";
import type { HelpBlock, Inline } from "@/content/help/types";

// Slug for an in-page heading anchor. Folding to ASCII matters here: the
// French headings are full of accents and a raw "Où vos données sont
// hébergées" makes a URL nobody can paste into Slack without it mangling.
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        if (typeof node === "string") return <span key={i}>{node}</span>;
        if (node.t === "ui")
          return (
            <span className="vyh-ui" key={i}>
              {node.text}
            </span>
          );
        if (node.t === "strong") return <strong key={i}>{node.text}</strong>;
        // Anything not rooted at "/" is off-site (mailto:, https:) and gets a
        // plain anchor — next-intl's Link would try to locale-prefix it.
        if (!node.href.startsWith("/")) {
          return (
            <a
              key={i}
              href={node.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {node.text}
            </a>
          );
        }
        return (
          <Link key={i} href={node.href}>
            {node.text}
          </Link>
        );
      })}
    </>
  );
}

function Block({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <p>
          <InlineNodes nodes={block.text} />
        </p>
      );
    case "h":
      return <h2 id={headingId(block.text)}>{block.text}</h2>;
    case "steps":
      return (
        <ol>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineNodes nodes={item} />
            </li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>
              <InlineNodes nodes={item} />
            </li>
          ))}
        </ul>
      );
    case "note":
      return (
        <div className="vyh-note">
          <p>
            <InlineNodes nodes={block.text} />
          </p>
        </div>
      );
    case "warn":
      return (
        <div className="vyh-warn">
          <p>
            <InlineNodes nodes={block.text} />
          </p>
        </div>
      );
  }
}

export function ArticleBody({ body }: { body: HelpBlock[] }) {
  return (
    <div className="vyh-prose">
      {body.map((block, i) => (
        <Block block={block} key={i} />
      ))}
    </div>
  );
}

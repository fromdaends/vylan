import { describe, it, expect } from "vitest";
import { routing } from "@/i18n/routing";
import {
  getCategories,
  getArticle,
  getCategory,
  allArticlePaths,
  buildSearchIndex,
  searchArticles,
  isCategorySlug,
} from "./registry";
import { HELP_STRUCTURE, CATEGORY_SLUGS } from "./manifest";
import { articleText, type HelpBlock, type Inline } from "./types";

const LOCALES = routing.locales;

describe("structure", () => {
  it("exposes every category in manifest order", () => {
    for (const locale of LOCALES) {
      expect(getCategories(locale).map((c) => c.slug)).toEqual(CATEGORY_SLUGS);
    }
  });

  it("exposes every article in manifest order", () => {
    for (const locale of LOCALES) {
      for (const category of CATEGORY_SLUGS) {
        expect(getCategory(locale, category).articles.map((a) => a.slug)).toEqual([
          ...HELP_STRUCTURE[category],
        ]);
      }
    }
  });

  it("resolves every manifest path in every locale", () => {
    for (const locale of LOCALES) {
      for (const { category, article } of allArticlePaths()) {
        expect(
          getArticle(locale, category, article),
          `${locale} ${category}/${article}`,
        ).not.toBeNull();
      }
    }
  });

  it("returns null for unknown slugs rather than throwing", () => {
    expect(getArticle("en", "getting-started", "nope")).toBeNull();
    expect(getArticle("en", "no-such-category", "what-is-vylan")).toBeNull();
    expect(isCategorySlug("no-such-category")).toBe(false);
  });
});

// The LocaleContent type already makes a missing translation a compile error.
// This is the belt to that braces: it also catches an article that exists but
// was left as a copy of the English, which the type can't see.
describe("EN/FR parity", () => {
  it("has the same paths in both locales", () => {
    const en = getCategories("en");
    const fr = getCategories("fr");
    expect(fr.map((c) => c.slug)).toEqual(en.map((c) => c.slug));
    for (let i = 0; i < en.length; i++) {
      expect(fr[i]!.articles.map((a) => a.slug)).toEqual(
        en[i]!.articles.map((a) => a.slug),
      );
    }
  });

  it("actually translated every title and summary", () => {
    for (const { category, article } of allArticlePaths()) {
      const en = getArticle("en", category, article)!;
      const fr = getArticle("fr", category, article)!;
      expect(fr.article.title, `${category}/${article} title`).not.toBe(
        en.article.title,
      );
      expect(fr.article.summary, `${category}/${article} summary`).not.toBe(
        en.article.summary,
      );
    }
  });

  it("translated the category titles", () => {
    for (const category of CATEGORY_SLUGS) {
      expect(getCategory("fr", category).meta.title).not.toBe(
        getCategory("en", category).meta.title,
      );
    }
  });
});

describe("content sanity", () => {
  it("every article has a title, a summary, keywords, and a body", () => {
    for (const locale of LOCALES) {
      for (const { category, article } of allArticlePaths()) {
        const { article: a } = getArticle(locale, category, article)!;
        const where = `${locale} ${category}/${article}`;
        expect(a.title.trim().length, where).toBeGreaterThan(0);
        // The summary doubles as the meta description and the search snippet,
        // so it has to be a real sentence, not a stub.
        expect(a.summary.trim().length, where).toBeGreaterThan(40);
        expect(a.keywords.length, where).toBeGreaterThan(0);
        expect(a.body.length, where).toBeGreaterThan(2);
      }
    }
  });
});

// Every internal link an article makes. A typo here is a 404 that nothing
// else would catch — the article still compiles, renders, and looks right.
function internalLinks(body: HelpBlock[]): string[] {
  const out: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (typeof n !== "string" && n.t === "link" && n.href.startsWith("/help/")) {
        out.push(n.href);
      }
    }
  };
  for (const block of body) {
    if (block.kind === "p" || block.kind === "note" || block.kind === "warn") {
      walk(block.text);
    } else if (block.kind === "steps" || block.kind === "list") {
      block.items.forEach(walk);
    }
  }
  return out;
}

describe("cross-links", () => {
  it("every /help link points at an article that exists", () => {
    const seen: string[] = [];
    for (const locale of LOCALES) {
      for (const { category, article } of allArticlePaths()) {
        const found = getArticle(locale, category, article)!;
        for (const href of internalLinks(found.article.body)) {
          seen.push(href);
          const [, , cat, slug, ...rest] = href.split("/");
          expect(rest, `${href} has too many segments`).toHaveLength(0);
          expect(
            getArticle(locale, cat!, slug!),
            `${locale} ${category}/${article} links to a dead ${href}`,
          ).not.toBeNull();
        }
      }
    }
    // Guards the guard: if the walker silently stopped finding links, the
    // loop above would pass by doing nothing.
    expect(seen.length).toBeGreaterThan(0);
  });
});

describe("search", () => {
  it("returns nothing for an empty or whitespace query", () => {
    const index = buildSearchIndex("en");
    expect(searchArticles(index, "")).toEqual([]);
    expect(searchArticles(index, "   ")).toEqual([]);
  });

  it("finds an article by a word in its title", () => {
    const index = buildSearchIndex("en");
    const hits = searchArticles(index, "portal");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("finds an article by a keyword that never appears in the prose", () => {
    // Nobody in the product or the articles says "magic link" — the prose
    // calls it "a private link". But it's exactly what an accountant would
    // type, so it's a keyword, and keywords have to be searchable.
    const index = buildSearchIndex("en");
    const hits = searchArticles(index, "magic link");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.slug).toBe("how-your-client-gets-their-link");
  });

  it("ranks a title match above a body-only match", () => {
    const index = buildSearchIndex("en");
    const hits = searchArticles(index, "upload");
    expect(hits.length).toBeGreaterThan(1);
    // "How your client uploads documents" has it in the title.
    expect(hits[0]!.title.toLowerCase()).toContain("upload");
  });

  it("requires every term to match, not any", () => {
    const index = buildSearchIndex("en");
    // Both words exist in the corpus, but not together in every article.
    const both = searchArticles(index, "reject client");
    const rejectOnly = searchArticles(index, "reject");
    expect(both.length).toBeLessThanOrEqual(rejectOnly.length);
    // A term that exists nowhere kills the whole query.
    expect(searchArticles(index, "upload zzzznope")).toEqual([]);
  });

  it("is accent-insensitive in French", () => {
    const index = buildSearchIndex("fr");
    // Nobody types accents into a search box.
    const unaccented = searchArticles(index, "televerse");
    expect(unaccented.length).toBeGreaterThan(0);
    expect(searchArticles(index, "téléverse").length).toBe(unaccented.length);
  });

  it("is case-insensitive", () => {
    const index = buildSearchIndex("en");
    expect(searchArticles(index, "VYLAN").length).toBe(
      searchArticles(index, "vylan").length,
    );
  });

  it("searches the French corpus, not the English one", () => {
    const fr = buildSearchIndex("fr");
    // An English-only word shouldn't hit in French.
    expect(searchArticles(fr, "téléverse").length).toBeGreaterThan(0);
    const en = buildSearchIndex("en");
    expect(searchArticles(en, "téléverse").length).toBe(0);
  });

  it("indexes one record per article per locale", () => {
    for (const locale of LOCALES) {
      expect(buildSearchIndex(locale)).toHaveLength(allArticlePaths().length);
    }
  });

  it("folds the haystack at build time so the browser does not re-fold it", () => {
    for (const r of buildSearchIndex("fr")) {
      expect(r.haystack).toBe(r.haystack.toLowerCase());
      expect(r.haystack).not.toMatch(/[éèêàçôûù]/);
    }
  });
});

describe("articleText", () => {
  it("pulls text out of every block kind", () => {
    const found = getArticle("en", "documents-and-ai", "how-vylan-checks-documents")!;
    const text = articleText(found.article);
    // A heading, a ui() chip inside a paragraph, and a list item.
    expect(text).toContain("There is a monthly limit");
    expect(text).toContain("Auto-reject invalid uploads");
  });
});

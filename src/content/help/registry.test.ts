import { describe, it, expect } from "vitest";
import { routing } from "@/i18n/routing";
import {
  getCategories,
  getArticle,
  getCategory,
  allArticlePaths,
  articlePathsFor,
  untranslated,
  buildSearchIndex,
  searchArticles,
  isCategorySlug,
} from "./registry";
import { HELP_STRUCTURE, CATEGORY_SLUGS } from "./manifest";
import { articleText, type HelpBlock, type Inline } from "./types";
import type { AppLocale } from "@/i18n/routing";
import enMessages from "../../../messages/en.json";
import frMessages from "../../../messages/fr.json";

const LOCALES = routing.locales;

describe("structure", () => {
  it("exposes every category in manifest order (English is the complete one)", () => {
    expect(getCategories("en").map((c) => c.slug)).toEqual(CATEGORY_SLUGS);
  });

  it("exposes every article in manifest order", () => {
    for (const category of CATEGORY_SLUGS) {
      expect(getCategory("en", category).articles.map((a) => a.slug)).toEqual([
        ...HELP_STRUCTURE[category],
      ]);
    }
  });

  it("keeps French in manifest order too, minus what isn't translated", () => {
    // Order is display order; a partial locale must not reshuffle it.
    for (const c of getCategories("fr")) {
      const manifest = [...HELP_STRUCTURE[c.slug]] as string[];
      const got = c.articles.map((a) => a.slug);
      expect(got).toEqual(manifest.filter((s) => got.includes(s)));
    }
    expect(getCategories("fr").map((c) => c.slug)).toEqual(
      CATEGORY_SLUGS.filter((s) =>
        getCategories("fr").some((c) => c.slug === s),
      ),
    );
  });

  it("resolves every manifest path in English", () => {
    for (const { category, article } of allArticlePaths()) {
      expect(
        getArticle("en", category, article),
        `en ${category}/${article}`,
      ).not.toBeNull();
    }
  });

  it("returns null for unknown slugs rather than throwing", () => {
    expect(getArticle("en", "getting-started", "nope")).toBeNull();
    expect(getArticle("en", "no-such-category", "what-is-vylan")).toBeNull();
    expect(isCategorySlug("no-such-category")).toBe(false);
  });
});

// PHASE 2: French is allowed to lag while English is drafted for review, so
// these check that the gap is CONTAINED, not that it's absent.
//
// PHASE 3 flips FR's type back to LocaleContent, at which point the compiler
// enforces full parity and `untranslated()` is empty for good. The last test
// here is what will tell you you're done.
describe("EN/FR parity", () => {
  it("never has a French article English doesn't", () => {
    const en = new Set(
      allArticlePaths().map(({ category, article }) => `${category}/${article}`),
    );
    for (const c of getCategories("fr")) {
      for (const a of c.articles) {
        expect(en.has(`${c.slug}/${a.slug}`), `${c.slug}/${a.slug}`).toBe(true);
      }
    }
  });

  it("never shows a French category with nothing in it", () => {
    for (const c of getCategories("fr")) {
      expect(c.articles.length, c.slug).toBeGreaterThan(0);
    }
  });

  it("actually translated what it claims to have translated", () => {
    const translated = allArticlePaths().filter(({ category, article }) =>
      getArticle("fr", category, article),
    );
    expect(translated.length).toBeGreaterThan(0);
    for (const { category, article } of translated) {
      const en = getArticle("en", category, article)!;
      const fr = getArticle("fr", category, article)!;
      // Same slug, genuinely different prose — not English pasted into fr/.
      expect(fr.article.title, `${category}/${article} title`).not.toBe(
        en.article.title,
      );
      expect(fr.article.summary, `${category}/${article} summary`).not.toBe(
        en.article.summary,
      );
    }
  });

  it("translated the category descriptions", () => {
    // The DESCRIPTION, not the title. Some titles are legitimately identical
    // in both languages: "Clients" and "Engagements" are French words too, and
    // "QuickBooks" is a product name. A description is a full sentence, so an
    // identical one means English was pasted into fr/ — which is what this is
    // actually looking for.
    for (const c of getCategories("fr")) {
      expect(c.meta.description, c.slug).not.toBe(
        getCategory("en", c.slug).meta.description,
      );
    }
  });

  // Not a failure during Phase 2 — this is the burn-down. When it hits zero,
  // flip FR back to LocaleContent in src/content/help/fr/index.ts.
  it("reports what Phase 3 still owes", () => {
    const todo = untranslated();
    const total = allArticlePaths().length;
    console.info(
      `[help] FR coverage: ${total - todo.length}/${total} translated` +
        (todo.length
          ? `, ${todo.length} to go: ${todo.map((t) => `${t.category}/${t.article}`).join(", ")}`
          : " — complete, flip FR to LocaleContent"),
    );
    expect(todo.length).toBeLessThanOrEqual(total);
  });
});

describe("content sanity", () => {
  it("every article has a title, a summary, keywords, and a body", () => {
    for (const locale of LOCALES) {
      for (const { category, article } of articlePathsFor(locale)) {
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

// Every ui() chip claims to be a label the reader will find on screen. This
// proves it. The founder caught a French article quoting "Envoyer des cartes
// de confirmation" when the app says "Afficher les cartes de confirmation" —
// an article that sends someone hunting for a button that isn't there is
// worse than no article, and that shouldn't depend on me being careful.
//
// Strings that legitimately aren't in messages/*.json:
//   * Built-in template names — seeded in SQL (migrations 0005/0170), not i18n.
//   * Sample data invented for the articles ("Lavoie CPA", "Marie").
//   * Rendered plural/interpolated examples ("3 files uploaded", "2 of 6 seats").
//   * The About placeholders.
const NOT_FROM_I18N =
  /^(Lavoie CPA|Marie|PLACEHOLDER|TEXTE PROVISOIRE|c|Empty|Vide|Logo)$|^(T1|T2) —|Monthly bookkeeping|Tenue de livres|Self-employed|Travailleur autonome|Rental income|Revenus de location|GST\/QST|TPS\/TVQ|Trust return|fiducie|Final return|Déclaration finale|New client onboarding|Accueil —|^(Hi|Bonjour) Marie|Lavoie CPA|files uploaded|fichiers téléversés|seats used|utilisateurs|This is your 2023|C'est votre T4|Sign page 3|Signez la page 3|Your December bank statement|Votre relevé bancaire|Office supplies|Fournitures de bureau/;

function uiLabelsOf(body: HelpBlock[]): string[] {
  const out: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (typeof n !== "string" && n.t === "ui") out.push(n.text);
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

function allStrings(obj: unknown, into = new Set<string>()): Set<string> {
  if (typeof obj === "string") into.add(obj.trim());
  else if (obj && typeof obj === "object") {
    for (const v of Object.values(obj)) allStrings(v, into);
  }
  return into;
}

describe("ui() labels are real", () => {
  const MESSAGES: Record<AppLocale, Set<string>> = {
    en: allStrings(enMessages),
    fr: allStrings(frMessages),
  };

  it.each(LOCALES)("every %s ui() chip exists in that locale's messages", (locale) => {
    const misses: string[] = [];
    let checked = 0;
    for (const { category, article } of articlePathsFor(locale)) {
      const found = getArticle(locale, category, article)!;
      for (const label of uiLabelsOf(found.article.body)) {
        if (NOT_FROM_I18N.test(label)) continue;
        checked++;
        const hit = [...MESSAGES[locale]].some(
          (v) =>
            v === label ||
            v.includes(label) ||
            label.includes(v.replace(/\{[^}]+\}/g, "").trim()),
        );
        if (!hit) misses.push(`${category}/${article}: "${label}"`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(misses, `labels not found in messages/${locale}.json`).toEqual([]);
  });
});

describe("cross-links", () => {
  it("every /help link points at an article that exists", () => {
    const seen: string[] = [];
    for (const locale of LOCALES) {
      // Per-locale: a French article must not link to an article French
      // doesn't have yet. That would be a 404 only French readers ever hit.
      for (const { category, article } of articlePathsFor(locale)) {
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

  it("indexes exactly what each locale can open", () => {
    for (const locale of LOCALES) {
      expect(buildSearchIndex(locale)).toHaveLength(
        articlePathsFor(locale).length,
      );
    }
    // English is the complete one.
    expect(buildSearchIndex("en")).toHaveLength(allArticlePaths().length);
  });

  it("never returns a French result that leads to a 404", () => {
    const fr = buildSearchIndex("fr");
    for (const r of fr) {
      expect(getArticle("fr", r.category, r.slug), `${r.category}/${r.slug}`)
        .not.toBeNull();
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

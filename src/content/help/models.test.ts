import { describe, it, expect, vi, afterEach } from "vitest";
import { getOpenAiModel, getProvider } from "@/lib/ai/classify";
import { CHAT_MODEL } from "@/lib/engagement-chat/config";
import { getArticle } from "./registry";
import { articleText } from "./types";

// ---------------------------------------------------------------------------
// THE TRIPWIRE
// ---------------------------------------------------------------------------
//
// The public help center NAMES the models we run, in both languages, because
// the founder asked for it (2026-07-16). That's a maintenance trap: the day
// someone bumps a model, three public articles quietly become wrong, and
// nothing else in this repo would notice.
//
// So this test pins each model id to the article that mentions it. Change a
// model and this fails with the exact list of files to edit. It is not here to
// stop you upgrading — upgrade freely. It is here so the website stops lying
// on the same commit.
//
// TO UPDATE: change the model, run the tests, and this failure tells you what
// to fix. Fix the articles, update the constant below, done.

type PinnedModel = {
  // What the code actually uses.
  actual: () => string;
  // What the articles say, verbatim.
  published: string;
  // Where it's published. These are checked for real, not just listed.
  articles: { locale: "en" | "fr"; category: string; slug: string }[];
  why: string;
};

const PINNED: Record<string, PinnedModel> = {
  "document classifier (OpenAI)": {
    actual: getOpenAiModel,
    published: "gpt-5.4",
    articles: [
      { locale: "en", category: "documents-and-ai", slug: "how-vylan-checks-documents" },
      { locale: "fr", category: "documents-and-ai", slug: "how-vylan-checks-documents" },
    ],
    why: "The articles say the check reads at full resolution, which is a property of gpt-5.4 specifically. A cheaper revision down-samples and the claim stops being true.",
  },
  "engagement chat (Anthropic)": {
    actual: () => CHAT_MODEL,
    published: "claude-haiku-4-5",
    articles: [
      { locale: "en", category: "ai-helpers", slug: "the-engagement-assistant" },
      { locale: "fr", category: "ai-helpers", slug: "the-engagement-assistant" },
    ],
    why: "The articles name Haiku 4.5 and explain why the cheap tier is the right call there.",
  },
};

// The articles print a human model name ("GPT-5.4", "Haiku 4.5"), not the raw
// id ("gpt-5.4", "claude-haiku-4-5"). Map one to the other.
function humanise(id: string): string {
  if (id.startsWith("gpt-")) return id.toUpperCase().replace("GPT-", "GPT-");
  const m = id.match(/^claude-([a-z]+)-(\d+)-(\d+)$/);
  if (m) {
    const [, family, major, minor] = m;
    return `${family[0]!.toUpperCase()}${family.slice(1)} ${major}.${minor}`;
  }
  return id;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("published model ids match the code", () => {
  it.each(Object.entries(PINNED))(
    "%s is still the model the articles name",
    (name, pin) => {
      expect(
        pin.actual(),
        `\n\n  The ${name} model changed.\n` +
          `  Code now: ${pin.actual()}\n` +
          `  Help center still says: ${pin.published}\n\n` +
          `  ${pin.why}\n\n` +
          `  Update these, then change \`published\` in this file:\n` +
          pin.articles
            .map(
              (a) =>
                `    src/content/help/${a.locale}/${a.category}.ts  (${a.slug})`,
            )
            .join("\n") +
          "\n",
      ).toBe(pin.published);
    },
  );

  it.each(Object.entries(PINNED))(
    "%s is actually named in every article that claims it",
    (name, pin) => {
      const human = humanise(pin.published);
      for (const a of pin.articles) {
        const found = getArticle(a.locale, a.category, a.slug);
        expect(found, `${a.locale} ${a.category}/${a.slug} is missing`).not.toBeNull();
        expect(
          articleText(found!.article),
          `${a.locale} ${a.category}/${a.slug} should name "${human}" (${name})`,
        ).toContain(human);
      }
    },
  );
});

// ---------------------------------------------------------------------------
// The one the founder actually asked about
// ---------------------------------------------------------------------------
describe("which provider runs the document check", () => {
  it("defaults to Anthropic, NOT OpenAI, when the env var is unset", () => {
    vi.stubEnv("AI_CLASSIFIER_PROVIDER", "");
    // This is the trap. The help center says the check runs on GPT-5.4, which
    // is only true when AI_CLASSIFIER_PROVIDER=openai is set in the deployed
    // environment. The code's own default is Anthropic. If that variable is
    // ever removed from Production, the article becomes false and no test can
    // catch it from here — prod env is not readable from a test run.
    expect(getProvider()).toBe("anthropic");
  });

  it("uses OpenAI only when the env var says so", () => {
    vi.stubEnv("AI_CLASSIFIER_PROVIDER", "openai");
    expect(getProvider()).toBe("openai");
    vi.stubEnv("AI_CLASSIFIER_PROVIDER", "OpenAI");
    expect(getProvider()).toBe("openai");
  });

  it("ignores anything else and falls back to Anthropic", () => {
    for (const v of ["anthropic", "claude", "gpt", "true", "1", "  "]) {
      vi.stubEnv("AI_CLASSIFIER_PROVIDER", v);
      expect(getProvider(), `AI_CLASSIFIER_PROVIDER=${JSON.stringify(v)}`).toBe(
        "anthropic",
      );
    }
  });
});

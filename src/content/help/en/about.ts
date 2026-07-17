import {
  type HelpArticle,
  type HelpCategoryMeta,
  p,
  h,
  ui,
  link,
  note,
  warn,
} from "../types";

// PLACEHOLDER CONTENT — founder rule, do not fill this in.
//
// The two co-founder NAMES are real and confirmed by the founder (2026-07-16):
// Zachary Thresh and Tyler Jette. Everything else on this page — the company
// story, the bios, the roles, the reason they started it — is PLACEHOLDER and
// is marked as such ON THE PAGE, in the reader's face, not in a code comment.
//
// Do NOT invent a founding story, a background, a job title, a hometown, a
// previous employer, or a motivation for either person. Do not "improve" the
// placeholders by making them sound plausible: a plausible invented bio is
// worse than an obvious blank, because nobody catches it. The founder is
// supplying the real copy. Until it lands, this page ships visibly unfinished
// or it does not ship at all.

export const meta: HelpCategoryMeta = {
  title: "About Vylan",
  description: "Who builds Vylan, and why.",
};

const PLACEHOLDER = "PLACEHOLDER";

const ourStory: HelpArticle = {
  title: "Our story",
  summary:
    "Why Vylan exists, in the founders' own words. This page is still being written.",
  keywords: ["about", "story", "company", "why", "mission", "founded", "history"],
  body: [
    warn(
      ui(PLACEHOLDER),
      " — this page is waiting on the real copy from the founders. Everything below is a stand-in and should not be read as fact.",
    ),

    h("Why Vylan exists"),
    p(
      ui(PLACEHOLDER),
      ": the story of why Vylan was started, told by the people who started it. Not written yet.",
    ),

    h("What we are trying to do"),
    p(
      ui(PLACEHOLDER),
      ": what the company is for, beyond the feature list. Not written yet.",
    ),

    note(
      "In the meantime, ",
      link("/how-it-works", "how it works"),
      " shows you the product itself, and ",
      link("/contact", "contact"),
      " reaches a real person.",
    ),
  ],
};

const theFounders: HelpArticle = {
  title: "The founders",
  summary:
    "Vylan is built by Zachary Thresh and Tyler Jette. Their full bios are still being written.",
  keywords: ["founders", "team", "who", "zachary", "thresh", "tyler", "jette", "about"],
  body: [
    warn(
      ui(PLACEHOLDER),
      " — the names below are real. The biographies are not written yet, and nothing has been invented to fill the gap.",
    ),

    h("Zachary Thresh"),
    p("Co-founder."),
    p(ui(PLACEHOLDER), ": bio to come."),

    h("Tyler Jette"),
    p("Co-founder."),
    p(ui(PLACEHOLDER), ": bio to come."),

    h("Talking to us"),
    p(
      "Vylan is small, which means the person answering hello@vylan.app is one of the people building it. If something here is wrong, or missing, or you just want to argue about how document collection should work, that address reaches us.",
    ),
    note(
      "Want to talk properly? ",
      link("/contact", "Contact"),
      " has the details, or book a demo from the ",
      link("/", "front page"),
      ".",
    ),
  ],
};

export const articles = {
  "our-story": ourStory,
  "the-founders": theFounders,
};

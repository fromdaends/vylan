import {
  type HelpArticle,
  type HelpCategoryMeta,
  p,
  h,
  ui,
  link,
  list,
  note,
  warn,
} from "../types";

export const meta: HelpCategoryMeta = {
  title: "AI helpers",
  description:
    "The two assistants inside the app: one that answers questions about Vylan, and one that knows a specific engagement.",
};

const askVylan: HelpArticle = {
  title: "Ask Vylan",
  summary:
    "An assistant inside the app that answers questions about how Vylan works, so you do not have to leave what you are doing.",
  keywords: [
    "ask",
    "assistant",
    "help",
    "chat",
    "ai",
    "question",
    "guide",
    "support",
  ],
  body: [
    p(
      "Ask Vylan is the help panel inside the app. It answers questions about the product: how to send an engagement, what a setting does, where something lives.",
    ),

    h("Using it"),
    p(
      "Open it from the ",
      ui("Help"),
      " item in your account menu, and ask in your own words, in English or French.",
    ),

    h("What it is for"),
    p(
      "Questions about Vylan. It is not a tax adviser and it will tell you so: it can describe what a T1135 is, but not whether you need one. That line is deliberate.",
    ),

    h("It can be wrong"),
    warn(
      "It is an AI, and it says so itself in the panel. For anything that matters, and especially for anything about your account or your billing, email hello@vylan.app and get an answer from a person.",
    ),

    h("This help center, or the assistant?"),
    p(
      "The assistant is faster for a quick question while you are mid-task. This help center goes deeper, is written by a person, gets checked, and does not guess. If the two ever disagree, believe this one and tell us.",
    ),
    note(
      "Found a bug or want to argue for a feature? The same panel sends feedback straight to the founders.",
    ),
  ],
};

const theEngagementAssistant: HelpArticle = {
  title: "The engagement assistant",
  summary:
    "A chat attached to one engagement, that can actually see it. It answers from that job's real data, and asks before it does anything.",
  keywords: [
    "assistant",
    "chat",
    "engagement",
    "ai",
    "actions",
    "confirm",
    "limit",
    "ask",
  ],
  body: [
    p(
      "Different from ",
      link("/help/ai-helpers/ask-vylan", "Ask Vylan"),
      ", which knows the product. This one knows the engagement you have open.",
    ),

    h("What it can tell you"),
    p(
      "It reads that engagement's actual data, so it answers about this job rather than in general:",
    ),
    list(
      ["What is still outstanding."],
      ["What the client has sent, and when."],
      ["What the document check made of a file."],
      ["Where the job has got to."],
    ),

    h("It asks before it acts, unless you tell it not to"),
    p(
      "It can do things, not just talk: approve a document, send a reminder, change a due date. By default it shows you a Confirm card first and nothing happens until you press it.",
    ),
    p(
      "That is a setting, not a law. ",
      ui("Send confirmation cards"),
      " lives in your automation settings, and turning it off means the assistant carries those actions out on its own, without asking.",
    ),
    warn(
      "Think hard before you turn confirmation off. With it on, confirming is you doing it, not the assistant, and you should read what it proposes the way you would read an email before sending it. With it off, the assistant acts on your firm and your clients by itself.",
    ),
    note(
      "One thing always asks, either way: deleting a checklist item. That permanently removes the files attached to it, so Vylan will not do it on a chat's say-so no matter how your settings are set.",
    ),

    h("There is a limit"),
    p(
      "Each person gets a set number of messages in a rolling window. Confirming or cancelling an action does not count against it, only asking does. If you hit the limit, wait a bit. Everything else in Vylan carries on working.",
    ),
    note(
      "It runs on Anthropic's Claude Haiku 4.5. The cheap, fast tier is deliberate: this assistant does not have to know anything, because every answer is looked up from your engagement's real data rather than recalled. Speed is the useful quality when you are mid-task.",
    ),
  ],
};

export const articles = {
  "ask-vylan": askVylan,
  "the-engagement-assistant": theEngagementAssistant,
};

import {
  type HelpArticle,
  type HelpCategoryMeta,
  p,
  h,
  link,
  list,
  note,
} from "../types";

// COMPLIANCE-SENSITIVE (founder rules, locked wording). Read before editing:
//
//   * NEVER "Vylan is SOC 2 compliant". Only "built on SOC 2 compliant
//     infrastructure", and only where it's actually relevant.
//   * "Data hosted in Canada" is correct and encouraged.
//   * E-signature claims are capped at "legally recognized" + "tamper-proof
//     audit trail". Nothing stronger, no jurisdiction-specific legal claims.
//   * User-facing only. No security mechanics, no architecture, no key
//     handling, no vendor internals — none of that is public content, and
//     describing your own locks in public is a poor trade.
//   * Law 25 is named as the law the product is built for. This does NOT
//     claim certification, and must never imply Vylan gives legal advice
//     about a firm's own obligations.

export const meta: HelpCategoryMeta = {
  title: "Security and data",
  description:
    "Where your clients' documents live, who can reach them, and what happens to them over time.",
};

const whereYourDataLives: HelpArticle = {
  title: "Where your data lives",
  summary:
    "Your data is hosted in Canada, on SOC 2 compliant infrastructure.",
  keywords: [
    "data",
    "canada",
    "hosting",
    "server",
    "location",
    "residency",
    "soc 2",
    "secure",
    "storage",
    "where",
  ],
  body: [
    p(
      "You are holding other people's tax documents. Where those sit is a fair question, and it should have a short answer.",
    ),

    h("In Canada"),
    p("Your data is hosted in Canada."),
    p(
      "For a Canadian firm handling Canadian clients' financial records, that is usually the answer that matters, and it is often the first thing a client asks.",
    ),

    h("The infrastructure"),
    p("Vylan is built on SOC 2 compliant infrastructure."),

    h("Getting it back"),
    p(
      "You can download everything your firm has, whenever you want, without asking us. See ",
      link("/help/account/downloading-your-data", "downloading all your data"),
      ".",
    ),
    note(
      "If a client or a regulator needs more detail than this page gives, write to hello@vylan.app and you will get a straight answer from a person.",
    ),
  ],
};

const howClientAccessWorks: HelpArticle = {
  title: "How client access works",
  summary:
    "Your client uses a private link instead of a password. Here is what that means, and what they can and cannot reach.",
  keywords: [
    "access",
    "link",
    "magic link",
    "password",
    "login",
    "security",
    "private",
    "share",
    "forward",
    "client",
  ],
  body: [
    p(
      "Clients do not get accounts. They get a private link. That is a deliberate trade, and it is worth understanding it rather than being surprised by it.",
    ),

    h("Why no password"),
    p(
      "Because passwords are where document collection goes to die. Every account you ask a client to create is a reason for them not to send you the thing. The link removes that, and it is the single biggest reason clients actually respond.",
    ),

    h("What the link opens"),
    p("One client's page, for the work you sent them. On it they can:"),
    list(
      ["See the documents you asked for."],
      ["Upload their files."],
      ["Sign what you sent to be signed."],
      ["Message you."],
      ["Pay their invoice."],
      ["Download the finished work."],
    ),
    p(
      "It does not open anyone else's documents, and it does not open your firm's side of Vylan.",
    ),

    h("Treat it like a key"),
    p(
      "The link is private, and it is not a public address someone could guess. But anyone holding it can open that page, so it is worth telling clients the same thing you would about any private link: do not forward it on.",
    ),
    note(
      "You can always resend a link, and every reminder carries it again. So a client who lost theirs is a moment's work, not a support case.",
    ),

    h("Your own account is different"),
    p(
      "None of this applies to you. Your firm's side is a real account with a real password, and you should turn on two-factor. See ",
      link("/help/account/two-factor-login", "two-factor login"),
      ".",
    ),
  ],
};

const privacyAndLaw25: HelpArticle = {
  title: "Privacy and Law 25",
  summary:
    "Vylan is built for Canadian firms handling personal information, including Quebec's Law 25.",
  keywords: [
    "privacy",
    "law 25",
    "loi 25",
    "quebec",
    "pipeda",
    "personal information",
    "compliance",
    "consent",
    "gdpr",
  ],
  body: [
    p(
      "Every document your clients send you is personal information, most of it the sensitive kind. That comes with obligations, and Vylan is built with them in mind.",
    ),

    h("Built for it"),
    p(
      "Vylan is built for Canadian accounting firms handling personal information, including under Quebec's Law 25. Your data is hosted in Canada, on SOC 2 compliant infrastructure.",
    ),

    h("What helps in practice"),
    list(
      ["Documents go to one place instead of an email inbox that never forgets."],
      ["Each client's link opens only their own page."],
      ["An audit log of what happened, when, and who did it."],
      ["Deleted engagements are permanently removed after 30 days, files included."],
      ["You can export everything your firm holds at any time."],
    ),

    h("Where Vylan stops"),
    note(
      "Vylan is a tool, not a compliance programme, and nothing here is legal advice. Your obligations to your clients are yours: what you collect, why, how long you keep it, and what you tell them about it. We can tell you where the data lives and hand you the record of what happened. What you owe your clients under the law is a question for your own advisers.",
    ),

    h("The full policy"),
    p(
      "The details are in ",
      link("/privacy", "our privacy policy"),
      ". For anything it does not answer, write to hello@vylan.app.",
    ),
  ],
};

export const articles = {
  "where-your-data-lives": whereYourDataLives,
  "how-client-access-works": howClientAccessWorks,
  "privacy-and-law-25": privacyAndLaw25,
};

import {
  type HelpArticle,
  type HelpCategoryMeta,
  p,
  h,
  ui,
  link,
  steps,
  list,
  note,
  warn,
} from "../types";

// These articles exist ONLY because the founder confirmed (2026-07-16) that
// QBO_ENVIRONMENT is "production" in Production. It fails safe to SANDBOX,
// which talks to a fake Intuit test company rather than a real client's books
// (see .env.example). If that switch ever goes back to sandbox, these articles
// become false and should come down the same day.
//
// Kept deliberately at the "what it does for you" level: no mention of tokens,
// scopes, or how matching is implemented. Internal mechanics are not public
// content.

export const meta: HelpCategoryMeta = {
  title: "QuickBooks",
  description:
    "Connect QuickBooks Online and let Vylan turn the documents you collect into transactions you approve.",
};

const connectingQuickbooks: HelpArticle = {
  title: "Connecting QuickBooks",
  summary:
    "Link your QuickBooks Online company once. Owners only, and you can disconnect whenever you like.",
  keywords: [
    "quickbooks",
    "qbo",
    "intuit",
    "connect",
    "integration",
    "link",
    "disconnect",
    "accounting software",
    "sync",
  ],
  body: [
    p(
      "If you keep your clients' books in QuickBooks Online, Vylan can carry what it collects the last mile, instead of you retyping a bank statement into a register.",
    ),

    h("Connecting"),
    steps(
      ["Go to your settings and open integrations."],
      ["Start the QuickBooks connection."],
      ["Sign in to Intuit and approve the connection. That happens on Intuit's side."],
      ["You land back in Vylan, connected."],
    ),
    note(
      "Owners only. Connecting a set of books is a firm-level decision. See ",
      link("/help/team/owners-and-members", "owners and members"),
      ".",
    ),

    h("What Vylan pulls in"),
    p(
      "Once connected, Vylan reads the lists it needs to speak your client's language: their accounts, customers, vendors, and tax codes. That is what lets a suggestion say ",
      ui("Office supplies"),
      " instead of guessing at a category that does not exist in their books.",
    ),

    h("Disconnecting"),
    p(
      "Disconnect from the same place, at any time. Vylan stops reading and stops posting.",
    ),
    note(
      "Next: ",
      link("/help/quickbooks/how-suggestions-work", "how Vylan suggests transactions"),
      ".",
    ),
  ],
};

const howSuggestionsWork: HelpArticle = {
  title: "How Vylan suggests transactions",
  summary:
    "Vylan reads the documents you collected, pulls the transactions out, and proposes where each one goes. Proposes.",
  keywords: [
    "suggestion",
    "suggestions",
    "transaction",
    "extract",
    "receipt",
    "bank statement",
    "categorize",
    "match",
    "learn",
    "ai",
  ],
  body: [
    p(
      "Your client uploads a stack of receipts and a bank statement. That is data trapped in pictures. Vylan reads them, pulls out the transactions, and works out where each one probably belongs in their books.",
    ),

    h("What it works out"),
    list(
      ["The transactions on the document: date, amount, who it was with."],
      ["Which account each one likely belongs to."],
      ["The customer or vendor, matched against the real ones in their books."],
      ["The tax code."],
    ),

    h("It proposes, you decide"),
    warn(
      "Nothing reaches your client's books without you approving it. Vylan produces drafts. A draft is a suggestion sitting in a queue, and it stays a suggestion until you say otherwise.",
    ),

    h("It learns from you"),
    p(
      "When you correct a suggestion, Vylan remembers. Correct the same vendor twice and it stops getting it wrong. The queue gets quieter the more you use it, which is the whole idea.",
    ),
    note(
      "Next: ",
      link("/help/quickbooks/reviewing-drafts", "reviewing the drafts"),
      ".",
    ),
  ],
};

const reviewingDrafts: HelpArticle = {
  title: "Reviewing the drafts",
  summary:
    "The drafts queue is where suggestions wait for you. Approve the good ones, fix the near ones, bin the rest.",
  keywords: [
    "draft",
    "drafts",
    "queue",
    "review",
    "approve",
    "reject",
    "edit",
    "fix",
    "bulk",
  ],
  body: [
    p(
      "Everything Vylan works out lands in one queue rather than scattering across engagements. You sit down once and clear it.",
    ),

    h("Getting there"),
    p(
      "The drafts queue is in your sidebar under integrations, once QuickBooks is connected.",
    ),

    h("What you do with each one"),
    list(
      ["Approve it, if Vylan got it right."],
      ["Fix it first, if it is close. Your correction is also how it learns."],
      ["Reject it, if it is not something that belongs in the books at all."],
    ),

    h("Where each draft came from"),
    p(
      "Every draft points back at the document it came from, so \"what is this $340\" is one click, not a hunt through a folder.",
    ),

    h("Nothing moves until you say so"),
    p(
      "A draft is inert. It sits in the queue until you approve it. Leaving the queue alone for a week changes nothing in your client's books.",
    ),
    note(
      "Next: ",
      link("/help/quickbooks/posting-to-quickbooks", "posting to QuickBooks"),
      ".",
    ),
  ],
};

const postingToQuickbooks: HelpArticle = {
  title: "Posting to QuickBooks",
  summary:
    "Approved drafts go into your client's real books. What happens, and what to do when one does not land.",
  keywords: [
    "post",
    "posting",
    "push",
    "sync",
    "quickbooks",
    "books",
    "failed",
    "error",
    "duplicate",
  ],
  body: [
    p(
      "Approving a draft is the moment it becomes real. Vylan writes it into the QuickBooks company you connected.",
    ),

    h("What lands"),
    p(
      "The transaction, with the account, the customer or vendor, and the tax code you approved. It appears in QuickBooks the way you would have typed it, minus the typing.",
    ),

    h("You can watch it"),
    p(
      "Every draft carries its state, so you can see what posted and what did not. A posted draft is done and leaves your queue.",
    ),

    h("When one does not post"),
    p(
      "Sometimes QuickBooks refuses. An account was renamed, a customer was deleted, something changed on their side since Vylan last looked. The draft stays in your queue with what happened, rather than disappearing and leaving a hole in the books.",
    ),
    p("Fix the underlying thing in QuickBooks, then approve it again."),

    h("Duplicates"),
    p(
      "Vylan checks against what is already in the register before proposing something, so the same receipt uploaded twice does not become two transactions.",
    ),
    warn(
      "It is still your client's ledger. Vylan is careful, but you are the accountant and the drafts queue exists so a person looks at every line before it lands.",
    ),
  ],
};

export const articles = {
  "connecting-quickbooks": connectingQuickbooks,
  "how-suggestions-work": howSuggestionsWork,
  "reviewing-drafts": reviewingDrafts,
  "posting-to-quickbooks": postingToQuickbooks,
};

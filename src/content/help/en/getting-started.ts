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
} from "../types";

export const meta: HelpCategoryMeta = {
  title: "Getting started",
  description:
    "What Vylan is, how it fits into your practice, and how to send your first request to a client.",
};

const whatIsVylan: HelpArticle = {
  title: "What Vylan is",
  summary:
    "Vylan collects documents from your clients for you. You say what you need, Vylan asks for it, chases it, checks it when it arrives, and tells you when everything is in.",
  keywords: [
    "overview",
    "what is vylan",
    "introduction",
    "accounting",
    "bookkeeping",
    "document collection",
    "canada",
    "quebec",
  ],
  body: [
    p(
      "Vylan is built for small Canadian accounting firms. It handles the part of the job that eats your week and bills nothing: getting paperwork out of clients.",
    ),
    p(
      "You tell Vylan what documents a client needs to send. Vylan emails them a private link, follows up on its own when they go quiet, checks each file as it lands, and shows you a single list of what is still missing. When the work is done, you can send the finished documents back, invoice, and get paid in the same place.",
    ),

    h("The basic loop"),
    steps(
      ["You create an ", ui("engagement"), ": one piece of work for one client, like a personal tax return."],
      ["You pick a template, which fills in the document checklist for you."],
      ["You send it. Your client gets an email with a private link."],
      ["Your client uploads their documents. No password, no account."],
      ["Vylan checks each upload and tells you if something looks wrong."],
      ["You approve what is good, reject what is not, and Vylan asks the client again."],
      ["When everything is in, you do the actual work, send it back, and get paid."],
    ),

    h("Who it is for"),
    p(
      "Small accounting and bookkeeping firms in Quebec and the rest of Canada. It works for a firm of one and for a firm with a handful of people. If you have teammates, you can turn on team mode and assign work between you.",
    ),

    h("It works in English and French"),
    p(
      "The whole product is bilingual, including the emails your clients receive. You choose your own language in your settings, and each client is contacted in theirs. The two are independent, so you can work in English while your client hears from Vylan in French.",
    ),

    h("Where your data lives"),
    p("Your data is hosted in Canada."),
    note(
      "Ready to try it? ",
      link("/how-it-works", "See how it works"),
      " for the visual tour, or read ",
      link("/help/getting-started/your-first-engagement", "your first engagement"),
      " to get moving.",
    ),
  ],
};

const yourFirstEngagement: HelpArticle = {
  title: "Your first engagement",
  summary:
    "An engagement is one piece of work for one client. Here is how to create one, choose what to ask for, and send it.",
  keywords: [
    "first",
    "new engagement",
    "create",
    "send",
    "template",
    "getting started",
    "start",
    "setup",
  ],
  body: [
    p(
      "An ",
      ui("engagement"),
      " is one piece of work for one client. A personal tax return for 2024. A month of bookkeeping. A GST/QST return. Each one carries its own document checklist, its own conversation with the client, and its own progress.",
    ),

    h("Create it"),
    steps(
      [
        "Click ",
        ui("New engagement"),
        ". It is on your overview page, and it also has a keyboard shortcut: press ",
        ui("c"),
        " from anywhere in the app.",
      ],
      ["Pick a template. This decides what documents Vylan will ask for."],
      ["Pick an existing client, or create a new one right there."],
      ["Give the engagement a title, so you recognise it in a list later."],
    ),

    h("Choose a template"),
    p(
      "A template is a reusable checklist. Vylan ships with several already built:",
    ),
    list(
      [ui("T1 — Personal")],
      [ui("T2 — Corporation")],
      [ui("Monthly bookkeeping")],
      [ui("Self-employed (T2125)")],
      [ui("Rental income (T776)")],
      [ui("GST/QST return")],
      [ui("Trust return (T3)")],
      [ui("Final return (estate)")],
      [ui("New client onboarding")],
    ),
    p(
      "There is also an ",
      ui("Empty"),
      " option in the picker if you would rather start from nothing and add the documents yourself.",
    ),
    note(
      "You are not stuck with the template. Once the engagement exists you can add, remove, and reword any document on the list before you send it.",
    ),

    h("Check the document list"),
    p(
      "Each row on the list is one document you are asking for. Every row has a document type attached, which is what lets Vylan check the upload later and notice when a client sends a 2023 slip instead of a 2024 one. Adjust the list until it matches what you actually need from this client.",
    ),

    h("Send it"),
    p(
      "Click send. Your client gets an email with a private link to their own page. They do not create an account and they do not choose a password. From here Vylan takes over the chasing: it follows up on its own schedule until the documents are in.",
    ),
    note(
      "Next: ",
      link(
        "/help/client-portal/how-your-client-gets-their-link",
        "how your client gets their link",
      ),
      ".",
    ),
  ],
};

export const articles = {
  "what-is-vylan": whatIsVylan,
  "your-first-engagement": yourFirstEngagement,
};

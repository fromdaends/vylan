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
  title: "The client portal",
  description:
    "The page your client lands on. How they get there, what they see, and how they send you their documents.",
};

const howYourClientGetsTheirLink: HelpArticle = {
  title: "How your client gets their link",
  summary:
    "When you send an engagement, your client gets an email with a private link to their own page. No account, no password.",
  keywords: [
    "magic link",
    "link",
    "email",
    "invite",
    "login",
    "password",
    "sign in",
    "access",
    "portal",
    "reminder",
    "follow up",
  ],
  body: [
    p(
      "The moment you send an engagement, your client receives an email from you with a link to their own private page. That page is the portal: it lists what you need, and it is where they upload it.",
    ),

    h("There is nothing for them to sign up for"),
    p(
      "This is the part clients usually brace for, and it does not happen. There is no account to create, no password to choose, and nothing to install. They click the link in the email and they are on their page. That is the whole thing.",
    ),
    p(
      "The link is private and specific to that client and that engagement. It is not a public address someone could guess, and it does not show anyone else's documents.",
    ),

    h("What the page says when they arrive"),
    p("The top of the page greets them by name and tells them who is asking:"),
    list(
      [ui("Hi Marie,")],
      [ui("Here's what Lavoie CPA needs from you.")],
      [ui("Your files are private and shared only with Lavoie CPA.")],
    ),
    p(
      "Underneath is the checklist you built, with a progress counter so they can see how far along they are.",
    ),

    h("If they lose the email"),
    p(
      "Clients lose emails. It is the most ordinary thing in the world. You can resend the link from the engagement, and Vylan's automatic reminders each contain the link again, so a client who ignored the first email gets another route back in without having to ask you.",
    ),
    note(
      "Reminders go out by email on their own schedule until the documents are in. See ",
      link("/help/reminders/how-reminders-work", "how automatic reminders work"),
      ".",
    ),

    h("Your branding, not ours"),
    p(
      "The portal carries your firm's name, your logo, and your brand colour, which you set once in your firm settings. The same accent colour is used in the emails your clients receive. To your client, this reads as your firm asking, because it is.",
    ),
  ],
};

const howClientsUpload: HelpArticle = {
  title: "How your client uploads documents",
  summary:
    "Your client uploads a file per row on their checklist. They can add several files to one row, and mark a row as not applicable when it does not apply to them.",
  keywords: [
    "upload",
    "file",
    "photo",
    "scan",
    "drag",
    "drop",
    "not applicable",
    "na",
    "add another",
    "phone",
    "mobile",
  ],
  body: [
    p(
      "Every row on your client's page is one document you asked for. Each row has its own upload button, so the client is never guessing which file goes where.",
    ),

    h("Uploading"),
    steps(
      ["The client clicks ", ui("Upload"), " on a row, or drags files onto it. The row says ", ui("or drop files here"), " to make that obvious."],
      ["They choose a file, or take a photo on their phone."],
      ["The row shows ", ui("Uploading…"), " while it transfers, then ", ui("Checking your document…"), " while Vylan reads it."],
      ["Seconds later the row updates with the result."],
    ),
    p(
      "Phone photos are expected here, not merely tolerated. A large share of what clients send is a photo of a slip taken on a kitchen table, and the upload handles large files by sending them in pieces, so a big scan on a weak connection still makes it.",
    ),

    h("More than one file for one row"),
    p(
      "Some rows need several files. Twelve months of bank statements is one row, not twelve. After the first upload the client sees ",
      ui("Add another"),
      ", and the row keeps a count: ",
      ui("3 files uploaded"),
      ".",
    ),

    h("When a row does not apply"),
    p(
      "Sometimes you ask for something the client does not have. Rather than leaving it blank forever and stalling the engagement, they can click ",
      ui("Not applicable"),
      " on that row. It stops being a hole in the checklist and Vylan stops chasing it.",
    ),
    p(
      "If they change their mind, ",
      ui('Undo "Not applicable"'),
      " puts the row back.",
    ),
    note(
      "You see every row they mark this way, so nothing is quietly skipped behind your back.",
    ),

    h("What the client sees on each row"),
    p("As things progress, each row carries its own status:"),
    list(
      [ui("Not started"), ": nothing uploaded yet."],
      [ui("Submitted"), ": uploaded, waiting on you."],
      [ui("In review"), ": you have it and are looking at it."],
      [ui("Approved"), ": you accepted it. Done."],
      [ui("Rejected, please re-upload"), ": something was wrong. Your reason is shown right there."],
      [ui("Not applicable"), ": the client said this one does not apply."],
    ),
    p(
      "When the last row is done, the page switches to ",
      ui("All documents received"),
      " and thanks them, so they know they are finished and can stop worrying about it.",
    ),
    note(
      "Next: ",
      link(
        "/help/documents-and-ai/how-vylan-checks-documents",
        "how Vylan checks each document",
      ),
      ".",
    ),
  ],
};

export const articles = {
  "how-your-client-gets-their-link": howYourClientGetsTheirLink,
  "how-clients-upload": howClientsUpload,
};

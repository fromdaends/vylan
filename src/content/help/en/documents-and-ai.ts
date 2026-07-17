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

export const meta: HelpCategoryMeta = {
  title: "Documents and AI checks",
  description:
    "What Vylan does with each file the moment it arrives, what the flags mean, and how you approve or send something back.",
};

const howVylanChecksDocuments: HelpArticle = {
  title: "How Vylan checks each document",
  summary:
    "Every upload gets read automatically and compared against what you asked for. Vylan tells you what it thinks it received and why. You still make the call.",
  keywords: [
    "ai",
    "check",
    "verify",
    "classify",
    "confidence",
    "blurry",
    "unreadable",
    "wrong document",
    "wrong year",
    "flag",
    "analysis",
    "reading",
    "limit",
    "cap",
  ],
  body: [
    p(
      "The second a client uploads a file, Vylan reads it and compares it against the document you actually asked for. This takes a few seconds. Your client sees ",
      ui("Checking your document…"),
      " while it happens.",
    ),

    warn(
      "The check is advisory. The product says so on the screen: ",
      ui("Suggestion only. You make the call."),
      " Vylan is telling you what it thinks it is looking at. It is not deciding for you, and you can overrule it on any document.",
    ),

    h("What it looks for"),
    list(
      ["Whether the file is the document type you requested, or something else entirely."],
      ["Whether it is readable, or too blurry, dark, or cut off to use."],
      ["Whether it covers the right year or period."],
      ["Whether the name on the document matches the client you are collecting for."],
      ["Whether it is a duplicate of something they already sent for this engagement."],
    ),

    h("What you see on the file"),
    p("The result shows up on the document as a short status:"),
    list(
      [ui("Looks right"), ": it read as the document you asked for."],
      [ui("Low confidence"), ": it is not sure. Worth your eyes."],
      [ui("Wrong document"), ": it read as something other than what you requested."],
      [ui("Needs review"), ": something is off and Vylan is handing it to you."],
      [ui("Auto-rejected"), ": it was sent back to the client automatically. See below."],
      [ui("Not analyzed"), ": the automatic read did not run. You can still review the file normally."],
    ),
    p(
      "When there is a mismatch, it says so in plain terms rather than a score. Things like ",
      ui("Expected T4, got T4A"),
      ", or ",
      ui("Expected 2024, but this reads 2023"),
      ", or a note that the name on the document does not match the client.",
    ),

    h("Why it thinks so"),
    p(
      "Open the details and Vylan shows its work: what it read, the issuer, the year or period, the form, the amounts it found, and what else it considered the document might be. If you disagree, there is a button that says exactly what it does: ",
      ui("AI was wrong, approve"),
      ".",
    ),
    p(
      "The reading itself is done by OpenAI's GPT-5.4, chosen for one specific reason: it looks at your client's document at full resolution. Cheaper models shrink an image before they see it, which is exactly how a scribble over the transit digits on a void cheque sails through as \"looks good\". The detail you need it to catch is small, so it does not get to squint.",
    ),

    h("Sending bad uploads back automatically"),
    p(
      "In your settings there is a toggle called ",
      ui("Auto-reject invalid uploads"),
      ". When it is on, Vylan sends an upload straight back to the client if it is unreadable, incomplete, or not the document that was requested, and asks them to resubmit. When it is off, those land in your review queue instead and nothing goes back to the client until you say so.",
    ),
    p(
      "The client's side of that is gentle. They see ",
      ui("This file looks wrong, please try again"),
      " with a nudge to take a fresh photo or send the correct document. When a file passes, they see ",
      ui("Received, looks good!"),
      " instead.",
    ),
    p(
      "There is a second toggle, ",
      ui("Auto-reject duplicates"),
      ", for the specific case of a client sending an exact copy of something they already uploaded for that engagement. On, it bounces automatically. Off, it gets flagged for you.",
    ),
    note(
      "These start off. Vylan does not send anything back to your client automatically unless you turn them on. Switching them on is faster, and means clients fix mistakes while they are still sitting there with the document in hand. Leaving them off means nothing reaches your client without passing your eyes first.",
    ),

    h("Chasing a missing page"),
    p(
      "A third toggle, ",
      ui("Auto-ask for missing pages"),
      ", handles the specific and very common case of a client photographing three pages of a four-page document. On, Vylan asks them for the missing page itself. Off, it is flagged for your review instead.",
    ),
    note(
      "There is a sensible limit built into this one, and it is worth knowing: if Vylan is not sure which page is missing, it always comes to you, never the client. It will not guess at your client.",
    ),

    h("Quebec slips"),
    p(
      ui("Include Quebec tax forms"),
      " is on by default, and most firms should leave it alone. Turn it off only if your firm works entirely outside Quebec: the Quebec-only slips, the RL-1, the RL-3 and so on, then disappear from every client checklist.",
    ),
    p(
      "Left on, it is smarter than it sounds. Those slips still drop off automatically for any client whose province is set outside Quebec, so a firm serving both sides of a border does not have to think about it.",
    ),

    h("There is a monthly limit"),
    p(
      "AI checks are capped per month. Your settings page shows where you stand and whether checks are ",
      ui("Active"),
      " or ",
      ui("Paused"),
      ", along with a count of how many you have used and when it resets.",
    ),
    p(
      "If you reach the limit, checks pause until the reset. Nothing else breaks: your clients can still upload exactly as before, and you review documents by hand in the meantime. Firms on a trial get a set number of free checks rather than a monthly allowance.",
    ),
    note(
      "Next: ",
      link(
        "/help/documents-and-ai/approving-and-rejecting",
        "approving and rejecting documents",
      ),
      ".",
    ),
  ],
};

const approvingAndRejecting: HelpArticle = {
  title: "Approving and rejecting documents",
  summary:
    "How to accept a document, how to send one back with a reason your client will actually understand, and what your client sees when you do.",
  keywords: [
    "approve",
    "reject",
    "send back",
    "reason",
    "re-upload",
    "resubmit",
    "review",
    "undo",
    "queue",
  ],
  body: [
    p(
      "Every document a client sends waits on one decision from you: is this the thing you asked for, or not. Vylan's read is a suggestion. This is the actual call.",
    ),

    h("Approving"),
    p(
      "Open the engagement, look at the document, and click ",
      ui("Approve"),
      ". The row is done. Your client's page updates to ",
      ui("Approved"),
      " and Vylan stops chasing that one.",
    ),
    p(
      "If Vylan flagged something you are happy with anyway, approve it. The override button is labelled ",
      ui("AI was wrong, approve"),
      " and using it is completely normal.",
    ),

    h("Rejecting"),
    steps(
      ["Click ", ui("Reject"), " on the document."],
      ["Write a short reason."],
      ["Confirm. The client is told immediately and the row reopens for them."],
    ),
    p(
      "Their page shows ",
      ui("Rejected, please re-upload"),
      " with your reason sitting right next to it, so they know what to do without emailing you to ask.",
    ),

    h("Write the reason for the client, not for yourself"),
    p(
      "Your client reads this exact text. The most useful reasons are specific and say what to do next. Vylan offers a few ready-made ones you can pick and edit:",
    ),
    list(
      [ui("Wrong document. I asked for a different slip.")],
      [ui("Wrong year. Please send the most recent one.")],
      [ui("Hard to read. Can you re-scan with better lighting?")],
      [ui("Missing pages. Please resend the full document.")],
    ),
    p(
      "A good reason names the problem and the fix, the way the built-in example does: ",
      ui('This is your 2023 T4. I need 2024.'),
    ),

    warn(
      "The client sees your reason word for word. Vylan warns you about this on the screen for a reason: keep names and other sensitive details out of it. Write it as if they are reading it, because they are.",
    ),

    h("Changing your mind"),
    p(
      "Rejected something by accident? There is an ",
      ui("Undo"),
      " on the rejection.",
    ),

    h("When the client is told"),
    p(
      "A rejection reaches the client through the same channels as everything else, and the document shows ",
      ui("Client notified"),
      " once that has happened, so you are never guessing whether the message went out.",
    ),
    note(
      "If auto-reject is on, Vylan already does this for the clearly broken uploads without waiting for you. See ",
      link(
        "/help/documents-and-ai/how-vylan-checks-documents",
        "how Vylan checks each document",
      ),
      ".",
    ),
  ],
};

export const articles = {
  "how-vylan-checks-documents": howVylanChecksDocuments,
  "approving-and-rejecting": approvingAndRejecting,
};

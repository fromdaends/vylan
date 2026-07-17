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
  title: "Payments and invoices",
  description:
    "Getting paid without leaving Vylan. Connecting Stripe, invoicing, how your client pays, and holding finished work until the bill is settled.",
};

const connectingStripe: HelpArticle = {
  title: "Connecting Stripe to get paid",
  summary:
    "Connect a Stripe account once and your clients can pay you from their portal. The money goes to your bank, not ours.",
  keywords: [
    "stripe",
    "connect",
    "payment",
    "bank",
    "payout",
    "card",
    "setup",
    "get paid",
  ],
  body: [
    p(
      "Vylan collects the documents, so it may as well collect the fee. Connect Stripe once and every engagement can carry an invoice your client pays in a couple of clicks.",
    ),

    h("What connecting means"),
    p(
      "Your clients pay you. The money lands in your bank account through your own Stripe account. Vylan is not a middleman holding your fees.",
    ),

    h("Setting it up"),
    steps(
      ["Go to your settings and open the payments section."],
      ["Start the Stripe connection. You will be handed to Stripe's own onboarding."],
      [
        "Give Stripe what it asks for: your business details and the bank account you want money paid into. This is between you and Stripe.",
      ],
      ["Come back to Vylan. The connection shows as active."],
    ),
    note(
      "Stripe decides what it needs to verify you, and how long that takes. It is usually quick, but a new account can sit in review for a bit. That is Stripe's process, not Vylan's.",
    ),

    h("Until it is connected"),
    p(
      "Everything else works exactly as normal. You can collect documents, review them, and finish jobs. Your client just will not see a way to pay online. If they land on a payment page before you are set up, they are told to contact you to arrange it rather than being left at a dead end.",
    ),
    note(
      "Next: ",
      link("/help/payments-and-invoices/creating-an-invoice", "creating an invoice"),
      ".",
    ),
  ],
};

const creatingAnInvoice: HelpArticle = {
  title: "Creating and sending an invoice",
  summary:
    "Add an invoice to an engagement and your client can pay it from the same page where they sent you their documents.",
  keywords: [
    "invoice",
    "bill",
    "charge",
    "amount",
    "send invoice",
    "unpaid",
    "paid",
    "fee",
  ],
  body: [
    p(
      "An invoice belongs to an engagement. That is the point: your client is not hunting through email for a bill about a job they have already been talking to you about in one place.",
    ),

    h("Adding one"),
    steps(
      ["Open the engagement."],
      ["Add an invoice and set the amount."],
      ["Send it. Your client sees it on their portal, and it reaches them by email too."],
    ),

    h("Watching it"),
    p(
      "The invoice sits on the engagement carrying its state: ",
      ui("Unpaid"),
      " until it settles, ",
      ui("Paid"),
      " once the money is through. You do not have to reconcile that by hand, Stripe tells Vylan and the engagement updates itself.",
    ),
    p(
      "An engagement with an invoice out sits at the ",
      ui("Awaiting payment"),
      " stage, so it shows up in your list as waiting on money rather than waiting on you. See ",
      link("/help/engagements/workflow-stages", "workflow stages"),
      ".",
    ),

    h("If you need to let one go"),
    p(
      "Not every invoice gets paid, and not every one should be chased. You can waive an invoice, which settles the matter without money changing hands and unlocks anything that was held behind it.",
    ),
    note(
      "You need Stripe connected for a client to pay online. See ",
      link("/help/payments-and-invoices/connecting-stripe", "connecting Stripe"),
      ".",
    ),
  ],
};

const howYourClientPays: HelpArticle = {
  title: "How your client pays",
  summary:
    "Your client pays from their portal with a card. No account, no app, and the receipt is immediate.",
  keywords: [
    "pay",
    "payment",
    "card",
    "client",
    "portal",
    "checkout",
    "receipt",
    "failed",
    "secure",
  ],
  body: [
    p(
      "The same private link your client has been uploading documents to is where they pay. There is nothing new for them to learn and nothing new to sign up for.",
    ),

    h("What they see"),
    p(
      "A payment block appears on their page: ",
      ui("Payment due"),
      ", the amount, your firm's name, and a ",
      ui("Pay now"),
      " button. It is marked ",
      ui("Secure payment by Stripe"),
      ", because that is who handles the card.",
    ),
    p(
      "When it goes through they see ",
      ui("Payment received"),
      " and a thank you, immediately. They can download the invoice for their records at any point.",
    ),

    h("Card details never touch Vylan"),
    p(
      "Payment is handled by Stripe end to end. Vylan is told whether a payment succeeded. It never sees or stores your client's card.",
    ),

    h("When a payment fails"),
    p(
      "Cards get declined. Vylan says so plainly and offers ",
      ui("Try again"),
      " rather than leaving your client staring at an error. If you are not set up to take payments yet, they are told to contact you to arrange it instead.",
    ),
    note(
      "You can also hold your finished work until the invoice is settled. See ",
      link("/help/payments-and-invoices/the-invoice-lock", "the invoice lock"),
      ".",
    ),
  ],
};

const theInvoiceLock: HelpArticle = {
  title: "The invoice lock",
  summary:
    "Hold the finished documents until the invoice is paid. Your client can still upload and still sign. Only the completed work waits.",
  keywords: [
    "lock",
    "invoice lock",
    "hold",
    "withhold",
    "unpaid",
    "release",
    "final documents",
    "locked until paid",
  ],
  body: [
    p(
      "Every firm has had the client who goes quiet the moment the return is in their hands. The invoice lock is for that.",
    ),

    h("What it does"),
    p(
      "Turn on ",
      ui("Lock final documents until this invoice is paid"),
      " and the completed work you send back stays locked on your client's portal until the invoice settles. The moment it is paid, it unlocks on its own. You do not have to be watching.",
    ),

    h("What it does not do"),
    p("This is deliberately narrow, and the product says so on the toggle:"),
    p(
      ui(
        "Your client can still upload and sign. Only the finished documents you send them stay locked until they pay.",
      ),
    ),
    p(
      "So your client is never locked out of their own paperwork. They can still send you things, still sign, still read the conversation. The only thing behind the lock is the finished product.",
    ),

    h("What your client sees"),
    p(
      "Not a wall. Their completed documents are visibly there, marked ",
      ui("Locked until paid"),
      ", with a line telling them they will be available as soon as the invoice is settled. They know exactly what they are getting and exactly what to do.",
    ),

    h("Letting it go"),
    p(
      "You can unlock a document by hand at any time without being paid, and you can waive the invoice entirely. The lock is a default, not a cage. A client with a genuine reason should not need to call you twice.",
    ),
    warn(
      "Think about who you turn this on for. It is the right tool for a client with a history. It is a strange greeting for one who has always paid on time.",
    ),
    note(
      "Next: ",
      link(
        "/help/payments-and-invoices/sending-final-documents",
        "sending final documents back",
      ),
      ".",
    ),
  ],
};

const sendingFinalDocuments: HelpArticle = {
  title: "Sending final documents back",
  summary:
    "Upload the completed work to the engagement and your client downloads it from the same page they uploaded to. No attachment, no file-size bounce.",
  keywords: [
    "final",
    "deliverable",
    "return",
    "send back",
    "completed",
    "download",
    "upload",
    "pdf",
    "note",
  ],
  body: [
    p(
      "The job ends where it started: on your client's portal. You upload the finished work, they download it. No email attachment to bounce, no third file-sharing tool.",
    ),

    h("Sending one"),
    steps(
      ["Open the engagement and find ", ui("Final documents"), "."],
      ["Click ", ui("Upload"), " and choose the file."],
      ["Add a note if it needs context. Optional, but it usually helps."],
      ["Upload. Your client can download it from their portal."],
    ),

    h("What you can send"),
    list(
      ["PDFs and images."],
      ["Up to 25 MB per file."],
      ["As many as the job needs."],
    ),

    h("The note"),
    p(
      "The note sits with the document in your client's portal. It is worth using. ",
      ui("Sign page 3 and send it back"),
      " prevents the email you would otherwise get tomorrow. Keep it under 1,000 characters.",
    ),

    h("What your client sees"),
    p(
      "A section called ",
      ui("Your completed documents"),
      ", described as the finished work from their accountant, ready to download. Each one has a ",
      ui("Download"),
      " button.",
    ),

    h("Getting one back"),
    p(
      "Uploaded the wrong file? Delete it. It disappears from your client's portal too.",
    ),
    note(
      "You can hold these until the invoice is paid. See ",
      link("/help/payments-and-invoices/the-invoice-lock", "the invoice lock"),
      ".",
    ),
  ],
};

export const articles = {
  "connecting-stripe": connectingStripe,
  "creating-an-invoice": creatingAnInvoice,
  "how-your-client-pays": howYourClientPays,
  "the-invoice-lock": theInvoiceLock,
  "sending-final-documents": sendingFinalDocuments,
};

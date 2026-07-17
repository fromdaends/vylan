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

// COMPLIANCE-SENSITIVE (founder rule, locked wording):
//   * Capped at "legally recognized" with a "tamper-proof audit trail".
//     Nothing stronger, and NO jurisdiction-specific legal claims — no "valid
//     with the CRA", no "compliant with PIPEDA/UETA", no naming provinces.
//   * Never state or imply Vylan gives legal advice about whether a given
//     document can be signed electronically. That is the firm's call.
//
// These articles exist ONLY because the founder confirmed (2026-07-16) that
// SIGNWELL_TEST_MODE is exactly "false" in Production. It fails safe to TEST,
// which produces WATERMARKED, NOT-LEGALLY-BINDING signatures (see src/lib/env.ts).
// If that switch ever flips back, DELETE these two articles the same day —
// every legal word below becomes false the moment it does.

export const meta: HelpCategoryMeta = {
  title: "E-signatures",
  description:
    "Sending a document to be signed, and how your client signs it without printing anything.",
};

const requestingASignature: HelpArticle = {
  title: "Requesting a signature",
  summary:
    "Upload a PDF to an engagement and ask your client to sign it. They sign in their browser, and the signed copy comes back to you.",
  keywords: [
    "signature",
    "sign",
    "esign",
    "e-signature",
    "request",
    "pdf",
    "signwell",
    "engagement letter",
    "authorization",
  ],
  body: [
    p(
      "Signatures live on the engagement, next to the documents. The same client, the same link, the same conversation.",
    ),

    h("Sending one"),
    steps(
      ["Open the engagement."],
      ["Request a signature and choose the PDF to be signed, up to 25 MB."],
      ["Send it. Your client is notified, and it appears on their portal to sign."],
    ),

    h("Following it"),
    p("The request carries its state on the engagement:"),
    list(
      [ui("Sent to client"), ": it is with them."],
      [ui("Awaiting signature"), ": still waiting."],
      [ui("Signed"), ": done."],
      [ui("Signed copy returned"), ": the completed document is back and downloadable."],
      [ui("Sent back"), ": you returned it to the client to redo."],
    ),
    p(
      "An engagement waiting on a signature sits at the ",
      ui("Awaiting signature"),
      " stage, so your list shows what it is actually waiting on. See ",
      link("/help/engagements/workflow-stages", "workflow stages"),
      ".",
    ),

    h("If it is not set up yet"),
    p(
      "If signing has not been configured for your firm, the request still creates the row on the checklist and shows ",
      ui("Signing setup needed"),
      ". Nothing is lost, and nothing goes to your client until it is ready.",
    ),

    h("Getting the signed copy"),
    p(
      "Once signed, ",
      ui("Download signed document"),
      " gives you the completed PDF. It is yours to file wherever you file things.",
    ),

    h("If they sign the wrong thing"),
    p(
      "You can send a signed copy back the way you would reject any document, with a reason your client reads. The built-in reasons cover the usual: ",
      ui("The document wasn't signed."),
      ", ",
      ui("Wrong document."),
      ", ",
      ui("The signed copy is hard to read."),
    ),
    note(
      "Next: ",
      link("/help/e-signatures/how-your-client-signs", "how your client signs"),
      ".",
    ),
  ],
};

const howYourClientSigns: HelpArticle = {
  title: "How your client signs",
  summary:
    "Your client signs in their browser, on the same page as everything else. No printing, no scanning, no account.",
  keywords: [
    "sign",
    "client",
    "portal",
    "browser",
    "print",
    "scan",
    "legally recognized",
    "audit trail",
    "phone",
  ],
  body: [
    p(
      "The bit clients dread is printing a page, signing it, scanning it crooked, and emailing it back. None of that happens here.",
    ),

    h("What they do"),
    steps(
      ["They open their portal link, the same one they upload to."],
      ["They see a ", ui("To sign"), " section with the document."],
      ["They open it and sign in the browser."],
      ["That is it. The signed copy comes back to you automatically."],
    ),
    p(
      "It works on a phone, which matters more than it sounds. A lot of signing happens on a couch.",
    ),

    h("They still do not need an account"),
    p(
      "Signing does not change the deal. No password, no sign-up, nothing to install. The private link is the access.",
    ),

    h("Is an electronic signature good enough?"),
    p(
      "Signatures collected through Vylan are legally recognized and carry a tamper-proof audit trail recording who signed, and when.",
    ),
    note(
      "Whether a particular document should be signed electronically is a judgment call for your firm, not something Vylan can answer for you. Vylan gives you the tool and the audit trail. What you use it for is yours to decide.",
    ),

    h("If they upload a signed copy instead"),
    p(
      "Some clients will print it anyway, out of habit. The portal has ",
      ui("Upload signed copy"),
      " for exactly that, so nobody is stuck because they did it the old way.",
    ),
  ],
};

export const articles = {
  "requesting-a-signature": requestingASignature,
  "how-your-client-signs": howYourClientSigns,
};

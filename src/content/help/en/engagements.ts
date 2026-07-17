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
  title: "Engagements",
  description:
    "The unit of work in Vylan. Templates, the document checklist, the stages a job moves through, and how to finish, archive, or delete one.",
};

const templates: HelpArticle = {
  title: "Templates",
  summary:
    "A template is a reusable document checklist. Vylan ships with nine, and you can build your own so you never type the same list twice.",
  keywords: [
    "template",
    "checklist",
    "reuse",
    "t1",
    "t2",
    "bookkeeping",
    "custom",
    "empty",
    "built-in",
  ],
  body: [
    p(
      "Most of your work repeats. Every personal tax return asks for roughly the same slips. A template captures that list once so you are not rebuilding it per client.",
    ),

    h("What ships with Vylan"),
    p("Nine built-in templates, ready to use:"),
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
      "The picker on a new engagement also offers ",
      ui("Empty"),
      ", which starts you with nothing and lets you add documents by hand.",
    ),
    note(
      "The built-ins are bilingual. Your client sees each document named in their own language, whichever language you work in.",
    ),

    h("Making your own"),
    steps(
      ["Go to ", ui("Templates"), " in the sidebar."],
      ["Click ", ui("+ New template"), "."],
      ["Add a row for each document you want to ask for."],
      ["Give each row a document type. This is the part that matters most, see below."],
      ["Save. It now appears in the picker alongside the built-ins."],
    ),

    h("Why the document type matters"),
    p(
      "Each row carries a document type: T4, RL-1, T5, a notice of assessment, a bank statement, and so on. That type is what Vylan compares the upload against. It is the difference between ",
      ui("Looks right"),
      " and ",
      ui("Expected T4, got T4A"),
      ".",
    ),
    p(
      "A row with a vague type still works, your client can still upload, and you can still approve. You just lose the automatic check on that row.",
    ),

    h("Editing a template later"),
    p(
      "Changing a template affects engagements you create from then on. Engagements you already sent keep the list they were sent with, so a client is never surprised by a document appearing on their page after the fact.",
    ),
    note(
      "Next: ",
      link("/help/engagements/the-document-checklist", "the document checklist"),
      ".",
    ),
  ],
};

const theDocumentChecklist: HelpArticle = {
  title: "The document checklist",
  summary:
    "Every engagement is a list of documents you are asking for. Here is how to shape that list before and after you send it.",
  keywords: [
    "checklist",
    "items",
    "documents",
    "request",
    "add",
    "remove",
    "required",
    "optional",
    "rows",
  ],
  body: [
    p(
      "Open an engagement and the middle of the page is a list. One row per document. That list is the whole conversation you are having with your client, so it is worth getting right.",
    ),

    h("Shaping the list"),
    p(
      "Add a row for anything the template missed. Remove rows that do not apply to this client. Reword a row if your client will not recognise the official name for it, because they read this exact text.",
    ),
    note(
      "Write rows the way your client thinks, not the way the CRA does. ",
      ui("Your December bank statement"),
      " gets a faster response than the form number.",
    ),

    h("Required and optional"),
    p(
      "Rows marked ",
      ui("Required"),
      " are what Vylan chases. An engagement is not finished while a required row is empty. Optional rows are asked for once and then left alone.",
    ),

    h("Changing the list after you send"),
    p(
      "You can add and remove rows on a live engagement. The client's page updates, and Vylan folds the change into its follow-ups rather than sending a separate announcement about it.",
    ),
    warn(
      "Removing a row your client already uploaded to removes that request. Their file is not silently deleted, but the row stops being part of the job. If you only meant to accept it, approve it instead.",
    ),

    h("When a client says a row does not apply"),
    p(
      "Clients can mark a row ",
      ui("Not applicable"),
      " themselves. It stops being a hole in the checklist and Vylan stops chasing it, and you can see every row they did that to. See ",
      link("/help/client-portal/how-clients-upload", "how your client uploads documents"),
      ".",
    ),
  ],
};

const workflowStages: HelpArticle = {
  title: "Workflow stages",
  summary:
    "Every live engagement sits at one of six stages, from collecting documents to completed. Vylan moves it for you as things actually happen.",
  keywords: [
    "stage",
    "stages",
    "workflow",
    "pipeline",
    "collecting",
    "in review",
    "preparation",
    "awaiting signature",
    "awaiting payment",
    "completed",
    "progress",
    "filter",
  ],
  body: [
    p(
      "An engagement is not just done or not done. It moves through a job. Vylan tracks where each one actually is, so a glance at your list tells you what needs you today.",
    ),

    h("The six stages"),
    list(
      [ui("Collecting"), ": waiting on documents from your client."],
      [ui("In review"), ": documents are in and waiting on your eyes."],
      [ui("In preparation"), ": you have what you need and the work is underway."],
      [ui("Awaiting signature"), ": you sent something to be signed."],
      [ui("Awaiting payment"), ": the work is done and an invoice is out."],
      [ui("Completed"), ": finished."],
    ),

    h("It moves on its own"),
    p(
      "You do not tick these off. Vylan works out the stage from what has genuinely happened: a client uploaded, you approved the last document, a signature came back, an invoice got paid. The stage follows the facts.",
    ),
    p(
      "It also skips. A job with nothing to sign never sits at ",
      ui("Awaiting signature"),
      ". A job you do not invoice through Vylan never waits at ",
      ui("Awaiting payment"),
      ".",
    ),

    h("Overriding it"),
    p(
      "Sometimes reality is ahead of the record. You can set the stage by hand from the stepper at the top of an engagement, or from the ",
      ui("..."),
      " menu on any row in your engagements list. Every stage is offered, because it is an override.",
    ),
    note(
      "An override is a statement of fact, not a lock. If something real happens afterwards, like a payment landing, Vylan will move the stage again.",
    ),

    h("Filtering by stage"),
    p(
      "Your ",
      ui("Active"),
      " engagements list has a stage filter, so you can pull up everything sitting at ",
      ui("In review"),
      " and clear the lot. The filter lives in the page address, so a filtered view survives you clicking into a job and coming back, and you can bookmark it.",
    ),
    note(
      "Stages are about where the work is. Whether an engagement is a draft, sent, complete, or deleted is a separate thing. See ",
      link("/help/engagements/statuses-and-stages", "statuses and stages"),
      ".",
    ),
  ],
};

const statusesAndStages: HelpArticle = {
  title: "Statuses and stages",
  summary:
    "Two different ideas that look similar. The status is what has happened to an engagement's life. The stage is where the work has got to.",
  keywords: [
    "status",
    "stage",
    "draft",
    "sent",
    "in progress",
    "complete",
    "difference",
    "confusing",
    "lifecycle",
  ],
  body: [
    p(
      "Vylan tracks two things about every engagement, and it is worth thirty seconds to separate them, because they answer different questions.",
    ),

    h("Status: what has happened to it"),
    list(
      [ui("Draft"), ": you built it but have not sent it. Your client knows nothing about it."],
      [ui("Sent"), ": your client has their link."],
      [ui("In progress"), ": documents are moving."],
      [ui("Complete"), ": you closed it."],
    ),
    p("You control the status. Sending, completing, and reopening are your calls."),

    h("Stage: where the work has got to"),
    p(
      "The stage is the six-step pipeline: collecting, in review, in preparation, awaiting signature, awaiting payment, completed. Vylan works it out from what has actually happened. See ",
      link("/help/engagements/workflow-stages", "workflow stages"),
      ".",
    ),

    h("Why both"),
    p(
      "Status answers \"is this job open?\" Stage answers \"what is this job waiting on?\" An engagement can be in progress for three weeks and the useful question is never whether it is open. It is whether it is waiting on your client, on you, or on a cheque.",
    ),

    h("Where you see them"),
    p(
      "Your engagements list shows the stage, because that is the actionable one. The tabs down the side, ",
      ui("Active"),
      ", ",
      ui("Ready to review"),
      ", ",
      ui("Drafts"),
      ", ",
      ui("Completed"),
      ", ",
      ui("Archived"),
      ", ",
      ui("Deleted"),
      ", split by status.",
    ),
  ],
};

const completingAndArchiving: HelpArticle = {
  title: "Completing and archiving",
  summary:
    "How to close a finished engagement, what completing actually stops, and the difference between archiving and deleting.",
  keywords: [
    "complete",
    "finish",
    "close",
    "archive",
    "archived",
    "reopen",
    "done",
    "stop reminders",
  ],
  body: [
    h("Completing"),
    p(
      "When a job is done, mark it complete. That closes it: Vylan stops chasing your client, the follow-ups stop, and messaging closes with a note to your client explaining why. The whole history stays readable.",
    ),
    p(
      "A completed engagement moves to your ",
      ui("Completed"),
      " tab and leaves your active list.",
    ),
    note(
      "Changed your mind, or the client sent one more thing? You can reopen a completed engagement. It goes back to being live and picks up where it left off.",
    ),

    h("Archiving"),
    p(
      "Archiving is for engagements you want out of the way but not gone. Last year's returns, say. Your ",
      ui("Archived"),
      " tab keeps them, and everything in them stays exactly as it was.",
    ),
    p(
      ui("Restore"),
      " brings one back to your active lists whenever you want it.",
    ),

    h("Archive or complete?"),
    p(
      "Complete when the work is finished. Archive when you want a tidy list. They are independent, and most firms complete first and archive later, at the end of a season.",
    ),
    note(
      "Deleting is a different thing, with a real safety net. See ",
      link("/help/engagements/deleting-and-restoring", "deleting and restoring"),
      ".",
    ),
  ],
};

const deletingAndRestoring: HelpArticle = {
  title: "Deleting and restoring",
  summary:
    "Deleting is reversible for 30 days, then it is permanent and takes the files with it. Here is exactly what happens and when.",
  keywords: [
    "delete",
    "deleted",
    "remove",
    "restore",
    "recover",
    "undo",
    "30 days",
    "permanent",
    "trash",
    "bin",
  ],
  body: [
    p(
      "Deleting an engagement does not destroy it on the spot. It moves to your ",
      ui("Deleted"),
      " tab, and you have a month to change your mind.",
    ),

    h("What happens when you delete"),
    steps(
      ["The engagement leaves your active lists."],
      ["It appears in ", ui("Deleted"), ", with a note of how long it has been there."],
      ["Vylan stops chasing your client about it."],
      ["Nothing is destroyed yet."],
    ),
    p(
      "Vylan is explicit about this on the screen: ",
      ui("You can recover it for 30 days before it's permanently removed."),
    ),

    h("Restoring"),
    p(
      "Open the ",
      ui("Deleted"),
      " tab and restore it. It returns with its documents, its history, and its conversation intact.",
    ),

    h("After 30 days"),
    warn(
      "At 30 days it is permanently removed, and the uploaded files go with it. That step cannot be undone by you or by us. If an engagement holds anything you might want later, download the files first, or archive it instead of deleting it.",
    ),
    p(
      "The tab says so plainly: ",
      ui(
        "Deleted engagements stay here for 30 days, then they're permanently removed along with their files.",
      ),
    ),

    h("Delete or archive?"),
    p(
      "Delete a mistake. Archive real work you are finished with. Archiving keeps everything forever and is what you want for a job you actually did. See ",
      link("/help/engagements/completing-and-archiving", "completing and archiving"),
      ".",
    ),
  ],
};

export const articles = {
  templates,
  "the-document-checklist": theDocumentChecklist,
  "workflow-stages": workflowStages,
  "statuses-and-stages": statusesAndStages,
  "completing-and-archiving": completingAndArchiving,
  "deleting-and-restoring": deletingAndRestoring,
};

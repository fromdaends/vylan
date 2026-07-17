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
  strong,
} from "../types";

// ACCURACY NOTE: reminders are EMAIL ONLY in this article, deliberately.
// src/lib/reminders.ts also builds an SMS, but src/lib/sms.ts is a silent
// no-op when the Twilio env vars are absent, and the founder confirmed
// (2026-07-16) they are NOT set in Production. The settings screen only ever
// promises email too ("Email the client automatically..."). An earlier draft
// of the client-portal article promised texts; it shipped and was corrected.
// If Twilio is ever configured, this article and that one both need updating.

export const meta: HelpCategoryMeta = {
  title: "Reminders and chasing",
  description:
    "The part that does the nagging for you. How the automatic follow-ups work, and how to change their timing, tone, and wording.",
};

const howRemindersWork: HelpArticle = {
  title: "How automatic reminders work",
  summary:
    "Vylan emails your client on a schedule while documents are still missing, and stops on its own the moment they are not.",
  keywords: [
    "reminder",
    "reminders",
    "follow up",
    "chase",
    "nag",
    "automatic",
    "schedule",
    "email",
    "stop",
  ],
  body: [
    p(
      "This is the part of the job nobody bills for: emailing a client for the fourth time about the same slip. Vylan does it instead, and it does not get embarrassed about it.",
    ),

    h("What happens after you send"),
    p(
      "Vylan lays out a schedule of follow-ups. Each one is an email to your client with their link and what is still outstanding. You do nothing.",
    ),

    h("When it stops"),
    p("Reminders stop on their own. Vylan checks before every send and skips it if:"),
    list(
      ["The engagement is complete or cancelled."],
      ["Nothing required is outstanding any more."],
      ["You have paused reminders on that engagement."],
    ),
    p(
      "That check happens at send time, not when you built the schedule. So a client who uploads everything at 2am stops hearing from Vylan immediately, without you touching anything.",
    ),
    note(
      "Your settings say it plainly: ",
      ui(
        "Email the client automatically while required documents are still outstanding. Completed and cancelled engagements stop automatically.",
      ),
    ),

    h("Only required documents count"),
    p(
      "Vylan chases required rows. An optional row left empty does not keep the emails coming. See ",
      link("/help/engagements/the-document-checklist", "the document checklist"),
      ".",
    ),

    h("A client with no email address"),
    warn(
      "Reminders are email. A client with no email address on file cannot receive them, and Vylan warns you on the engagement when that is the case. Add an address before a reminder is due, or that client is one you will be chasing yourself.",
    ),
    note(
      "Next: ",
      link("/help/reminders/changing-reminders", "changing the reminders"),
      ".",
    ),
  ],
};

const changingReminders: HelpArticle = {
  title: "Changing the reminders",
  summary:
    "Set a default schedule for your whole firm, then bend it per engagement. You control the timing, how often, the tone, and the words.",
  keywords: [
    "customize",
    "change",
    "reminder",
    "schedule",
    "tone",
    "pause",
    "default",
    "timing",
    "days",
    "repeat",
    "wording",
    "subject",
  ],
  body: [
    p(
      "The default schedule is a starting point, not a rule. Some clients need three nudges. Some need none and would be annoyed by one.",
    ),

    h("Your firm's default"),
    p(
      "In your settings, ",
      ui("Default automatic reminders"),
      " is the schedule every new engagement starts with. Build it once and it applies from then on.",
    ),
    note(
      "Changing your default does not touch engagements that already exist. Vylan says so when you edit it: existing engagements will not change.",
    ),

    h("Per engagement"),
    p(
      "Open an engagement, find ",
      ui("Automatic reminders"),
      ", and click ",
      ui("Customize reminders"),
      ". The default was copied onto this engagement when you created it, and changing it here changes only this one.",
    ),

    h("What you can change"),
    list(
      [
        strong("Timing"),
        ": how many days after sending, or how many days after the due date.",
      ],
      [strong("How often"), ": repeat a reminder a set number of times."],
      [
        strong("Tone"),
        ": ",
        ui("Friendly reminder"),
        ", ",
        ui("Follow-up reminder"),
        ", ",
        ui("Final reminder"),
        ", or ",
        ui("Overdue reminder"),
        ".",
      ],
      [
        strong("The words"),
        ": a custom subject and message, or leave them blank for Vylan's own.",
      ],
    ),

    h("Writing your own"),
    p(
      "If you write a custom message, you can drop in details Vylan fills at send time: the client's name, the engagement, your firm, what is still pending, and the due date. So one line of yours still reads as if you wrote it for that person.",
    ),

    h("Seeing when they will land"),
    p(
      "The schedule shows you the estimated send times as you build it, so you are not doing date arithmetic in your head. Reminders counted from a due date need one set before Vylan can show you exact dates.",
    ),

    h("Pausing"),
    p(
      "You can pause reminders on an engagement. Useful when a client has told you they are away, or when you are mid-conversation and another automated nudge would be tone-deaf. Nothing else about the engagement changes.",
    ),
  ],
};

export const articles = {
  "how-reminders-work": howRemindersWork,
  "changing-reminders": changingReminders,
};

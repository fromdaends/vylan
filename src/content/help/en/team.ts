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

// ACCURACY NOTE: the two roles are labelled "Owner" and "Member" on screen.
// The database calls the second one `staff`, but no user ever sees that word —
// so neither does this article. Naming a role the UI doesn't use sends the
// reader hunting for something that isn't there.
//
// Seat caps are real (per-plan, plus a per-firm override) and the UI says
// "Upgrade your plan to invite more members" — but in-app billing is switched
// off (BILLING_ENABLED = false) and /pricing is retired, so there is no
// self-serve upgrade to point anyone at. These articles state that seats are
// limited and say to get in touch. They do NOT describe an upgrade flow that
// doesn't exist, and they quote no prices.

export const meta: HelpCategoryMeta = {
  title: "Team and roles",
  description:
    "Working with colleagues. Turning on team mode, inviting people, who can do what, and dividing the work.",
};

const turningOnTeamMode: HelpArticle = {
  title: "Turning on team mode",
  summary:
    "Team mode adds the shared tools: teammates, work assignment, and a record of who did what. It is a switch you flip when you want it.",
  keywords: [
    "team",
    "team mode",
    "enable",
    "turn on",
    "solo",
    "collaboration",
    "leave team",
  ],
  body: [
    p(
      "A firm of one does not need a column showing who a job belongs to. So Vylan does not show one until you say you want it.",
    ),

    h("Turning it on"),
    p(
      "Team mode is a switch in your settings. Flip it and the shared tools appear: a team section in the sidebar, work assignment on engagements and clients, and filters for your own work.",
    ),
    note(
      "You do not need a second person first. Turn it on while you are still solo and everything is ready for the day someone joins, including assigning work to yourself.",
    ),

    h("Turning it off"),
    p(
      "Leaving team mode hides all of it again. Vylan only lets you do that when you are genuinely on your own, so nobody can pull the floor out from under a colleague who is still working.",
    ),
    note(
      "Next: ",
      link("/help/team/inviting-teammates", "inviting teammates"),
      ".",
    ),
  ],
};

const invitingTeammates: HelpArticle = {
  title: "Inviting teammates",
  summary:
    "Send an invitation by email. They create their own account and land in your firm.",
  keywords: [
    "invite",
    "teammate",
    "colleague",
    "add user",
    "seats",
    "email",
    "expires",
    "join",
  ],
  body: [
    h("Sending an invitation"),
    steps(
      ["Go to your team settings."],
      ["Click ", ui("Invite teammate"), "."],
      ["Enter their email address."],
      [
        "Pick the language the invitation is written in. It does not lock them in, they can change their own language later.",
      ],
      ["Click ", ui("Send invitation"), "."],
    ),
    p(
      "They get an email to create their account and join your firm. Vylan tells you who invited whom and when each invitation expires, so a stale one is obvious.",
    ),

    h("If they already use Vylan"),
    p(
      "Someone who already has a Vylan account can move it into your firm. Because that means leaving whatever firm they are in now, Vylan makes them confirm with their password and spells out what they are giving up first.",
    ),

    h("Seats"),
    p(
      "Your team settings show ",
      ui("2 of 6 seats used"),
      " so you always know where you stand. Firms have a limit on how many people they can have.",
    ),
    note(
      "Hit the limit and need more room? Get in touch at hello@vylan.app. Pricing is a conversation right now rather than a button.",
    ),

    h("Removing someone"),
    p(
      "Deactivating a teammate is immediate: they lose access and are signed out. Their past activity stays in your records, which is the point, and you can reactivate them later if they come back.",
    ),
  ],
};

const ownersAndMembers: HelpArticle = {
  title: "Owners and members",
  summary:
    "Two roles. The owner runs the firm. Members do the work. Here is exactly where the line falls.",
  keywords: [
    "role",
    "roles",
    "owner",
    "member",
    "staff",
    "permission",
    "permissions",
    "access",
    "transfer",
    "admin",
  ],
  body: [
    p("Vylan has two roles today, and they are deliberately simple."),

    h("Member"),
    p(
      "The working role. Members do everything the job needs: create engagements, collect and review documents, message clients, request signatures, invoice, and finish jobs.",
    ),

    h("Owner"),
    p("Everything a member can do, plus the things that affect the firm itself:"),
    list(
      ["Inviting and removing teammates."],
      ["Firm settings and branding."],
      ["Billing."],
      ["The firm-wide audit log."],
      ["Exporting all of the firm's data."],
    ),
    p("There is exactly one owner at a time."),

    h("Handing it over"),
    p(
      "You can transfer ownership to another member. Vylan is blunt about what that means: ",
      ui(
        "The member you choose becomes the owner (billing, settings, team management), and you become a regular member.",
      ),
    ),
    warn(
      "You cannot take it back yourself. Once you transfer, the new owner has to hand it back. Be sure before you confirm.",
    ),

    h("What everyone can see"),
    p(
      "Both roles see the firm's clients and engagements. Vylan does not have private engagements today, so anyone in the firm can open any job. If that is not what you need, tell us at hello@vylan.app rather than working around it.",
    ),
  ],
};

const assigningWork: HelpArticle = {
  title: "Assigning work and seeing who did what",
  summary:
    "Give an engagement or a client an owner so the team knows whose desk it is on, and check the activity log when you need to know what happened.",
  keywords: [
    "assign",
    "assignment",
    "owner",
    "mine",
    "who",
    "activity",
    "log",
    "history",
    "reassign",
  ],
  body: [
    h("Assigning"),
    p(
      "With team mode on, engagements and clients can be assigned to a person. It is not a lock, it is a label: everyone can still work on everything, but nobody wonders whose job it is.",
    ),
    p(
      "You can reassign at any time, which is what actually happens when someone takes holiday.",
    ),

    h("Just my work"),
    p(
      "Your lists can filter to what is assigned to you, so a shared firm still gives you a personal to-do list.",
    ),

    h("Who did what"),
    p(
      "Team settings carry an activity record of what your team has been doing. It answers the ordinary questions: who approved that, when did this go out, who talked to this client last.",
    ),
    note(
      "Owners also get a fuller, firm-wide audit log with filters. See ",
      link("/help/account/the-audit-log", "the audit log"),
      ".",
    ),
  ],
};

export const articles = {
  "turning-on-team-mode": turningOnTeamMode,
  "inviting-teammates": invitingTeammates,
  "owners-and-members": ownersAndMembers,
  "assigning-work": assigningWork,
};

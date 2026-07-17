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
  title: "Account and settings",
  description:
    "Your profile, your firm's look, how you sign in, and how to get all of your data out whenever you want it.",
};

const yourProfile: HelpArticle = {
  title: "Your profile",
  summary: "Your name, your picture, and how you sign in.",
  keywords: ["profile", "name", "avatar", "picture", "photo", "account", "password"],
  body: [
    p(
      "Your profile is the personal half of your settings. Your firm's settings are separate, see ",
      link("/help/account/firm-branding", "firm branding"),
      ".",
    ),

    h("Name and picture"),
    p(
      "Set your display name and upload an avatar. Your teammates see both, on assignments and in the activity record, which is what makes a shared firm feel like people rather than rows.",
    ),

    h("Signing in"),
    p(
      "You can sign in with Google, or with an email and password. Whichever you use, turning on two-factor is the single best thing you can do for your account. See ",
      link("/help/account/two-factor-login", "two-factor login"),
      ".",
    ),
  ],
};

const twoFactorLogin: HelpArticle = {
  title: "Two-factor login",
  summary:
    "Add a second step to signing in, so a stolen password is not enough on its own. Save the recovery codes.",
  keywords: [
    "2fa",
    "two factor",
    "mfa",
    "totp",
    "authenticator",
    "security",
    "recovery codes",
    "locked out",
    "google authenticator",
  ],
  body: [
    p(
      "You hold other people's tax documents. Two-factor is the difference between someone having your password and someone having your clients' paperwork.",
    ),

    h("Turning it on"),
    steps(
      ["Go to your profile and find the security section."],
      ["Start the setup. A QR code appears."],
      [
        "Scan it with an authenticator app: Google Authenticator, 1Password, Authy, whichever you already use.",
      ],
      ["Enter the six-digit code it shows you, to prove it worked."],
      ["Save your recovery codes somewhere safe. See below, this is the important bit."],
    ),
    p(
      "From then on, signing in asks for a code from your app as well as your password.",
    ),

    h("The recovery codes"),
    warn(
      "The recovery codes are your only way back in if you lose your phone. Not a support ticket, not an email to us. Save them somewhere that is not your phone: a password manager, or paper in a drawer. People skip this step and then lose their phone, and that is a genuinely bad day.",
    ),
    p("Each code works once. If you use some, generate a fresh set."),

    h("If you lose your phone"),
    p(
      "Sign in with a recovery code, then set up two-factor again on your new phone.",
    ),
  ],
};

const firmBranding: HelpArticle = {
  title: "Firm branding",
  summary:
    "Your logo and your colour, on the page your clients see and the emails they get. Set once.",
  keywords: [
    "brand",
    "branding",
    "logo",
    "colour",
    "color",
    "firm",
    "white label",
    "portal",
    "email",
    "accent",
  ],
  body: [
    p(
      "Your client should feel like they are dealing with your firm, because they are. Vylan's name is not the one that needs to be on that page.",
    ),

    h("What you set"),
    p("In your firm settings:"),
    list(
      [ui("Firm name"), ": what your clients see you called."],
      [ui("Logo"), ": appears on the portal."],
      [ui("Brand colour"), ": the accent on the portal and in your emails."],
    ),

    h("Where it shows"),
    p(
      "Your client's portal and the emails Vylan sends on your behalf. The greeting they read names your firm, not us: ",
      ui("Here's what Lavoie CPA needs from you."),
    ),
    note(
      "Pick a colour with enough contrast to read against white. If the default is doing you no harm, leaving it alone is a perfectly good decision.",
    ),
  ],
};

const languageAndTheme: HelpArticle = {
  title: "Language, theme, and timezone",
  summary:
    "How you set your own working preferences, and why your language and your client's are separate.",
  keywords: [
    "language",
    "french",
    "english",
    "theme",
    "dark mode",
    "light",
    "timezone",
    "preferences",
    "settings",
  ],
  body: [
    h("Language"),
    p(
      "Choose English or French for your own interface. It changes immediately.",
    ),
    p(
      "This is yours alone. Each client is contacted in their own language, whichever you work in, so an English-speaking accountant can serve a French-speaking client and both read everything in their own language.",
    ),

    h("Theme"),
    p(
      "Light or dark for the app, or follow your computer's setting. Your clients get their own light and dark switch on their portal.",
    ),

    h("Timezone"),
    p(
      "Set your timezone so dates and times read correctly, and so reminders land at a sensible hour rather than in the middle of the night.",
    ),
  ],
};

const downloadingYourData: HelpArticle = {
  title: "Downloading all your data",
  summary:
    "Take everything your firm has out of Vylan whenever you want. Spreadsheets plus every file, in one download.",
  keywords: [
    "export",
    "download",
    "backup",
    "data",
    "csv",
    "zip",
    "leave",
    "portability",
    "all files",
  ],
  body: [
    p(
      "Your data is yours. Not in the abstract: there is a button, and it gives you all of it.",
    ),

    h("How"),
    p(
      "Go to your settings, find the data section, and download your firm's data. You get a ZIP containing spreadsheets of your records plus every file your clients ever uploaded.",
    ),
    note(
      "Owners only, since it is the whole firm's data in one file. See ",
      link("/help/team/owners-and-members", "owners and members"),
      ".",
    ),

    h("Why you might"),
    list(
      ["A backup you keep yourself."],
      ["Your accountant's accountant wants records."],
      ["You are moving to something else, and you would like to leave with your work."],
    ),
    p(
      "That last one is deliberate. Being able to leave is the reason to trust staying.",
    ),

    h("Just one client"),
    p(
      "You do not need everything to find one thing. Any client's archive downloads file by file, and any engagement has a download-all. See ",
      link("/help/clients/the-client-archive", "the client document archive"),
      ".",
    ),
  ],
};

const theAuditLog: HelpArticle = {
  title: "The audit log",
  summary:
    "A firm-wide record of what happened, when, and who did it. Owners only.",
  keywords: [
    "audit",
    "log",
    "history",
    "who",
    "activity",
    "record",
    "compliance",
    "trail",
    "filter",
  ],
  body: [
    p(
      "The audit log answers questions after the fact. Who approved that document. When did that go to the client. What happened to this engagement last Tuesday.",
    ),

    h("Getting there"),
    p(
      "Your settings, under the audit log. It is owner-only, because it covers everyone in the firm.",
    ),

    h("What is in it"),
    p(
      "Firm-wide activity with filters, so you can narrow to a person, a kind of event, or a stretch of time instead of scrolling.",
    ),

    h("Audit log or activity record?"),
    p(
      "Your team settings have a lighter who-did-what panel that any teammate can read. The audit log is the full, filterable, owner-only version. See ",
      link("/help/team/assigning-work", "assigning work and seeing who did what"),
      ".",
    ),
  ],
};

export const articles = {
  "your-profile": yourProfile,
  "two-factor-login": twoFactorLogin,
  "firm-branding": firmBranding,
  "language-and-theme": languageAndTheme,
  "downloading-your-data": downloadingYourData,
  "the-audit-log": theAuditLog,
};

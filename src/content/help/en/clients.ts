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
  title: "Clients",
  description:
    "The people you work for. Adding them, bringing over a list you already have, and finding a document from three years ago.",
};

const addingClients: HelpArticle = {
  title: "Adding and managing clients",
  summary:
    "A client is a person or business you do work for. Everything you have ever collected from them hangs off their record.",
  keywords: [
    "client",
    "clients",
    "add",
    "new",
    "contact",
    "email",
    "phone",
    "search",
    "sort",
    "duplicate",
  ],
  body: [
    p(
      "Clients are the spine of Vylan. Every engagement belongs to one, every document belongs to an engagement, so a client record quietly accumulates the whole history of your relationship.",
    ),

    h("Adding one"),
    p(
      "Click ",
      ui("+ Add client"),
      " on your clients page. You need a name and an email address. The email matters: it is where their private link goes.",
    ),
    p(
      "You can also create a client while making an engagement, without breaking your stride.",
    ),

    h("Finding one"),
    p(
      "The clients list has search, sorting, and a filter for active clients only. Search is accent-insensitive, so ",
      ui("Etienne"),
      " finds ",
      ui("Étienne"),
      ", which matters when you are typing fast.",
    ),
    p(
      "Clicking a client expands them in place to show their engagements. You do not lose your list to check one thing.",
    ),

    h("Duplicates"),
    p(
      "Vylan notices when you are about to add someone who looks like someone you already have, and says so before you end up with two of them.",
    ),

    h("Their whole history"),
    p(
      "Every client has a document archive going back as far as you have used Vylan. See ",
      link("/help/clients/the-client-archive", "the client document archive"),
      ".",
    ),
    note(
      "Have a list already? ",
      link("/help/clients/importing-clients", "Import it from a spreadsheet"),
      " instead of typing it twice.",
    ),
  ],
};

const importingClients: HelpArticle = {
  title: "Importing clients from a spreadsheet",
  summary:
    "Bring your client list over in one go from a CSV file, rather than typing it in one at a time.",
  keywords: [
    "import",
    "csv",
    "spreadsheet",
    "excel",
    "bulk",
    "migrate",
    "upload",
    "list",
  ],
  body: [
    p(
      "Nobody is retyping two hundred clients. If you have them in a spreadsheet, and everyone does, bring the file.",
    ),

    h("Doing it"),
    steps(
      ["Go to your clients page and choose ", ui("Import CSV"), "."],
      ["Upload your file."],
      ["Check what Vylan read back to you."],
      ["Confirm. Your clients are in."],
    ),

    h("Getting the file ready"),
    p(
      "A CSV is what you get from ",
      ui("Save as"),
      " or ",
      ui("Export"),
      " in Excel, Numbers, or Google Sheets. One row per client, with at least a name and an email address.",
    ),
    note(
      "Tidy the spreadsheet before you import rather than after. Fixing a column in Excel takes a minute. Fixing two hundred client records by hand does not.",
    ),

    h("Duplicates"),
    p(
      "Importing a list that overlaps with clients you already have is normal, and Vylan flags the overlap rather than silently doubling everyone up.",
    ),
  ],
};

const theClientArchive: HelpArticle = {
  title: "The client document archive",
  summary:
    "Every document you have ever collected from a client, in one place, searchable. Built for the request that starts \"do you still have\".",
  keywords: [
    "archive",
    "history",
    "old",
    "past",
    "find",
    "search",
    "download",
    "previous",
    "year",
    "documents",
  ],
  body: [
    p(
      "A client calls and needs the notice of assessment you collected two years ago. That is what this is for.",
    ),

    h("Getting there"),
    p("Open a client and go to their documents archive."),

    h("What is in it"),
    p(
      "Everything, grouped by engagement, going back as far as you have used Vylan:",
    ),
    list(
      ["The documents they uploaded."],
      ["Anything they signed."],
      ["The finished work you sent back."],
    ),

    h("Finding one thing"),
    p("A five-year history is only useful if you can cut through it, so the archive has:"),
    list(
      ["Search across file names and engagement titles, accent-insensitive."],
      ["Sorting by newest, oldest, or name."],
      ["A filter by category."],
      ["Expand and collapse everything at once."],
    ),
    p(
      "The counts update as you filter, so what you see is what matched.",
    ),

    h("Getting a copy out"),
    p(
      "Download any file straight from the archive. For a whole engagement's worth, there is a download-all on the engagement itself, and you can export everything your firm has from your settings. See ",
      link("/help/account/downloading-your-data", "downloading all your data"),
      ".",
    ),
  ],
};

export const articles = {
  "adding-clients": addingClients,
  "importing-clients": importingClients,
  "the-client-archive": theClientArchive,
};

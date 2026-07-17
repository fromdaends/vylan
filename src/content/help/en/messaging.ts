import {
  type HelpArticle,
  type HelpCategoryMeta,
  p,
  h,
  ui,
  link,
  list,
  note,
} from "../types";

export const meta: HelpCategoryMeta = {
  title: "Messaging",
  description:
    "A direct line to your client, attached to the job you are both talking about.",
};

const messagingYourClient: HelpArticle = {
  title: "Messaging your client",
  summary:
    "Each engagement has its own conversation. Your client reads and replies from their portal, with no email thread to lose.",
  keywords: [
    "message",
    "messages",
    "chat",
    "conversation",
    "reply",
    "client",
    "portal",
    "seen",
    "email",
  ],
  body: [
    p(
      "Questions come up. Which year is this statement? Do you need both pages? Normally that becomes an email thread nobody can find in March. Here it is attached to the engagement it is about.",
    ),

    h("How it works"),
    p(
      "Open an engagement and you will find the conversation with that client. Type, send, done. They see it in their portal, on the same page as their documents, and can reply from there.",
    ),
    p(
      "Vylan describes it to you exactly as it behaves: ",
      ui(
        "This is a direct line between you and your client — they see these messages in their portal.",
      ),
    ),

    h("Knowing they read it"),
    p(
      "A message your client has read is marked ",
      ui("Seen"),
      ". So \"did they get my message\" stops being a question you have to ask.",
    ),

    h("When messaging is open"),
    p("The conversation follows the engagement's life:"),
    list(
      [
        "Before you send it, messaging is closed. There is nobody to talk to yet, and Vylan says so: messaging opens once it's sent.",
      ],
      ["While it is live, messaging is open."],
      [
        "Once it is complete or cancelled, messaging closes. The whole history stays readable to both of you.",
      ],
    ),
    note(
      "Closing on completion is deliberate. A finished engagement should not quietly become a support channel months later. If a client needs you again, that is a new engagement, or a phone call.",
    ),

    h("It is not email"),
    p(
      "Messages live in the portal. Your client does not need an account to read them, the same as everything else on that page. See ",
      link(
        "/help/client-portal/how-your-client-gets-their-link",
        "how your client gets their link",
      ),
      ".",
    ),
  ],
};

export const articles = {
  "messaging-your-client": messagingYourClient,
};

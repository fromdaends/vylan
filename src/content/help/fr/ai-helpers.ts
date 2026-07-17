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
} from "../types";

export const meta: HelpCategoryMeta = {
  title: "Assistants IA",
  description:
    "Les deux assistants dans l'application : celui qui répond aux questions sur Vylan, et celui qui connaît un engagement précis.",
};

const askVylan: HelpArticle = {
  title: "Demander à Vylan",
  summary:
    "Un assistant dans l'application qui répond aux questions sur le fonctionnement de Vylan, sans que vous quittiez ce que vous faites.",
  keywords: [
    "demander",
    "assistant",
    "aide",
    "clavardage",
    "ia",
    "question",
    "guide",
    "soutien",
  ],
  body: [
    p(
      "L'assistant est le panneau d'aide dans l'application. Il répond aux questions sur le produit : comment envoyer un engagement, ce que fait un réglage, où se trouve quelque chose.",
    ),

    h("S'en servir"),
    p(
      "Ouvrez-le depuis l'item ",
      ui("Aide"),
      " de votre menu de compte, et posez la question dans vos mots, en français ou en anglais.",
    ),

    h("À quoi il sert"),
    p(
      "Aux questions sur Vylan. Ce n'est pas un fiscaliste et il vous le dira : il peut décrire ce qu'est un T1135, mais pas si vous en avez besoin. Cette ligne est voulue.",
    ),

    h("Il peut se tromper"),
    warn(
      "C'est une IA, et il le dit lui-même dans le panneau. Pour tout ce qui compte, et surtout pour tout ce qui touche votre compte ou votre facturation, écrivez à hello@vylan.app et obtenez une réponse d'une personne.",
    ),

    h("Ce centre d'aide, ou l'assistant ?"),
    p(
      "L'assistant est plus rapide pour une question éclair en plein travail. Ce centre d'aide va plus loin, est écrit par une personne, est vérifié, et ne devine pas. Si les deux se contredisent, croyez celui-ci et dites-le-nous.",
    ),
    note(
      "Trouvé un bogue ou envie de plaider pour une fonctionnalité ? Le même panneau envoie vos commentaires directement aux fondateurs.",
    ),
  ],
};

const theEngagementAssistant: HelpArticle = {
  title: "L'assistant d'engagement",
  summary:
    "Un clavardage rattaché à un seul engagement, qui le voit vraiment. Il répond à partir des données réelles de ce mandat, et demande avant d'agir.",
  keywords: [
    "assistant",
    "clavardage",
    "engagement",
    "ia",
    "actions",
    "confirmer",
    "limite",
  ],
  body: [
    p(
      "Différent de ",
      link("/help/ai-helpers/ask-vylan", "Demander à Vylan"),
      ", qui connaît le produit. Celui-ci connaît l'engagement que vous avez ouvert.",
    ),

    h("Ce qu'il peut vous dire"),
    p(
      "Il lit les données réelles de cet engagement, alors il répond sur ce mandat-là plutôt qu'en général :",
    ),
    list(
      ["Ce qui est encore en attente."],
      ["Ce que le client a envoyé, et quand."],
      ["Ce que la vérification de document a conclu d'un fichier."],
      ["Où le mandat est rendu."],
    ),

    h("Il demande avant d'agir"),
    p(
      "Il peut faire des choses, pas seulement en parler. Mais chaque action qu'il propose vous est présentée à confirmer ou à annuler d'abord. Rien n'arrive à votre client ou à votre engagement parce qu'un clavardage a décidé que ça devrait.",
    ),
    warn(
      "Confirmer, c'est vous qui le faites, pas l'assistant. Lisez ce qu'il propose avant de confirmer, comme vous liriez un courriel avant de l'envoyer.",
    ),

    h("Il y a une limite"),
    p(
      "Chaque personne a un nombre de messages donné sur une période glissante. Confirmer ou annuler une action ne compte pas, seules les questions comptent. Si vous atteignez la limite, attendez un peu. Tout le reste de Vylan continue de fonctionner.",
    ),
  ],
};

export const articles = {
  "ask-vylan": askVylan,
  "the-engagement-assistant": theEngagementAssistant,
};

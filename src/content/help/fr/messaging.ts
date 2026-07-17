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
  title: "Messagerie",
  description:
    "Une ligne directe avec votre client, rattachée au mandat dont vous parlez tous les deux.",
};

const messagingYourClient: HelpArticle = {
  title: "Écrire à votre client",
  summary:
    "Chaque engagement a sa propre conversation. Votre client la lit et répond depuis son portail, sans fil de courriels à perdre.",
  keywords: [
    "message",
    "messages",
    "messagerie",
    "conversation",
    "repondre",
    "répondre",
    "client",
    "portail",
    "vu",
    "courriel",
  ],
  body: [
    p(
      "Des questions surgissent. C'est quelle année, ce relevé ? Vous avez besoin des deux pages ? D'habitude ça devient un fil de courriels que personne ne retrouve en mars. Ici, c'est rattaché à l'engagement dont il est question.",
    ),

    h("Comment ça marche"),
    p(
      "Ouvrez un engagement et vous y trouvez la conversation avec ce client. Vous écrivez, vous envoyez, c'est fait. Il la voit dans son portail, sur la même page que ses documents, et peut répondre de là.",
    ),
    p(
      "Vylan vous le décrit exactement comme ça se comporte : ",
      ui(
        "C'est une ligne directe entre vous et votre client : il voit ces messages dans son portail.",
      ),
    ),

    h("Savoir qu'il l'a lu"),
    p(
      "Un message que votre client a lu est marqué ",
      ui("Vu"),
      ". La question « est-ce qu'il a eu mon message » cesse donc d'en être une.",
    ),

    h("Quand la messagerie est ouverte"),
    p("La conversation suit la vie de l'engagement :"),
    list(
      [
        "Avant l'envoi, la messagerie est fermée. Il n'y a encore personne à qui parler, et Vylan le dit : la messagerie ouvre une fois l'engagement envoyé.",
      ],
      ["Tant qu'il est actif, la messagerie est ouverte."],
      [
        "Une fois terminé ou annulé, la messagerie se ferme. Tout l'historique reste lisible pour vous deux.",
      ],
    ),
    note(
      "La fermeture à la fin est voulue. Un engagement terminé ne devrait pas devenir discrètement un canal de soutien des mois plus tard. Si un client a encore besoin de vous, c'est un nouvel engagement, ou un appel.",
    ),

    h("Ce n'est pas du courriel"),
    p(
      "Les messages vivent dans le portail. Votre client n'a pas besoin d'un compte pour les lire, comme pour le reste de cette page. Voyez ",
      link(
        "/help/client-portal/how-your-client-gets-their-link",
        "comment votre client reçoit son lien",
      ),
      ".",
    ),
  ],
};

export const articles = {
  "messaging-your-client": messagingYourClient,
};

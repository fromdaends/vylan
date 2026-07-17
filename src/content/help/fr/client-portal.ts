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
  title: "Le portail client",
  description:
    "La page sur laquelle votre client atterrit. Comment il s'y rend, ce qu'il y voit, et comment il vous envoie ses documents.",
};

const howYourClientGetsTheirLink: HelpArticle = {
  title: "Comment votre client reçoit son lien",
  summary:
    "Dès que vous envoyez un engagement, votre client reçoit un courriel avec un lien privé vers sa propre page. Aucun compte, aucun mot de passe.",
  keywords: [
    "lien magique",
    "lien",
    "courriel",
    "invitation",
    "connexion",
    "mot de passe",
    "acces",
    "accès",
    "portail",
    "relance",
    "suivi",
  ],
  body: [
    p(
      "Au moment où vous envoyez un engagement, votre client reçoit de votre part un courriel contenant un lien vers sa propre page privée. Cette page, c'est le portail : elle liste ce dont vous avez besoin, et c'est là qu'il le téléverse.",
    ),

    h("Il n'a rien à créer"),
    p(
      "C'est la partie que les clients redoutent d'habitude, et elle n'a pas lieu. Aucun compte à créer, aucun mot de passe à choisir, rien à installer. Il clique sur le lien dans le courriel et il est sur sa page. C'est tout.",
    ),
    p(
      "Le lien est privé et propre à ce client et à cet engagement. Ce n'est pas une adresse publique que quelqu'un pourrait deviner, et elle n'affiche les documents de personne d'autre.",
    ),

    h("Ce que la page dit à son arrivée"),
    p("Le haut de la page le salue par son nom et lui dit qui demande :"),
    list(
      [ui("Bonjour Marie,")],
      [ui("Voici les documents dont Lavoie CPA a besoin.")],
      [ui("Vos fichiers sont privés et partagés uniquement avec Lavoie CPA.")],
    ),
    p(
      "En dessous se trouve la liste que vous avez bâtie, avec un compteur de progression pour qu'il voie où il en est.",
    ),

    h("S'il perd le courriel"),
    p(
      "Les clients perdent des courriels. C'est la chose la plus ordinaire du monde. Vous pouvez renvoyer le lien depuis l'engagement, et chaque relance automatique de Vylan contient à nouveau le lien : un client qui a ignoré le premier courriel a donc un autre chemin de retour sans avoir à vous le demander.",
    ),
    note(
      "Les relances partent par courriel, selon leur propre calendrier, tant que les documents ne sont pas entrés. Voyez ",
      link("/help/getting-started/your-first-engagement", "votre premier engagement"),
      " pour le fonctionnement de l'envoi.",
    ),

    h("Votre image de marque, pas la nôtre"),
    p(
      "Le portail porte le nom de votre cabinet, votre logo et votre couleur de marque, que vous réglez une seule fois dans les paramètres du cabinet. La même couleur d'accent est reprise dans les courriels que vos clients reçoivent. Pour votre client, c'est votre cabinet qui demande, parce que c'est le cas.",
    ),
  ],
};

const howClientsUpload: HelpArticle = {
  title: "Comment votre client téléverse ses documents",
  summary:
    "Votre client téléverse un fichier par ligne de sa liste. Il peut en ajouter plusieurs à une même ligne, et marquer une ligne comme non applicable lorsqu'elle ne le concerne pas.",
  keywords: [
    "televerser",
    "téléverser",
    "fichier",
    "photo",
    "numeriser",
    "numériser",
    "glisser",
    "deposer",
    "déposer",
    "non applicable",
    "ajouter un autre",
    "cellulaire",
    "telephone",
    "téléphone",
  ],
  body: [
    p(
      "Chaque ligne de la page de votre client correspond à un document que vous avez demandé. Chaque ligne a son propre bouton de téléversement : le client ne se demande jamais quel fichier va où.",
    ),

    h("Téléverser"),
    steps(
      [
        "Le client clique sur ",
        ui("Téléverser"),
        " sur une ligne, ou y glisse ses fichiers. La ligne indique ",
        ui("ou déposez vos fichiers ici"),
        " pour que ce soit évident.",
      ],
      ["Il choisit un fichier, ou prend une photo avec son cellulaire."],
      [
        "La ligne affiche ",
        ui("Téléversement…"),
        " pendant le transfert, puis ",
        ui("Vérification de votre document…"),
        " pendant que Vylan le lit.",
      ],
      ["Quelques secondes plus tard, la ligne affiche le résultat."],
    ),
    p(
      "Les photos prises au cellulaire sont attendues ici, pas seulement tolérées. Une bonne partie de ce que les clients envoient est une photo d'un feuillet prise sur un coin de table, et le téléversement gère les gros fichiers en les envoyant en morceaux : une numérisation volumineuse sur une connexion faible passe quand même.",
    ),

    h("Plusieurs fichiers pour une même ligne"),
    p(
      "Certaines lignes demandent plusieurs fichiers. Douze mois de relevés bancaires, c'est une ligne, pas douze. Après le premier téléversement, le client voit ",
      ui("Ajouter un autre"),
      ", et la ligne tient le compte : ",
      ui("3 fichiers téléversés"),
      ".",
    ),

    h("Quand une ligne ne s'applique pas"),
    p(
      "Il arrive que vous demandiez quelque chose que le client n'a pas. Plutôt que de laisser la ligne vide indéfiniment et de bloquer l'engagement, il peut cliquer sur ",
      ui("Non applicable"),
      ". La ligne cesse d'être un trou dans la liste et Vylan arrête de la relancer.",
    ),
    p(
      "S'il change d'idée, ",
      ui("Annuler « Non applicable »"),
      " remet la ligne en place.",
    ),
    note(
      "Vous voyez chaque ligne marquée ainsi : rien n'est écarté en douce dans votre dos.",
    ),

    h("Ce que le client voit sur chaque ligne"),
    p("Au fil de la progression, chaque ligne porte son propre statut :"),
    list(
      [ui("À faire"), " : rien n'a encore été téléversé."],
      [ui("Soumis"), " : téléversé, en attente de vous."],
      [ui("En révision"), " : vous l'avez et vous l'examinez."],
      [ui("Approuvé"), " : vous l'avez accepté. Terminé."],
      [
        ui("Refusé : à reprendre"),
        " : quelque chose clochait. Votre raison est affichée juste à côté.",
      ],
      [ui("Non applicable"), " : le client a indiqué que ça ne le concerne pas."],
    ),
    p(
      "Quand la dernière ligne est réglée, la page bascule sur ",
      ui("Tous les documents reçus"),
      " et le remercie : il sait qu'il a terminé et peut cesser d'y penser.",
    ),
    note(
      "Ensuite : ",
      link(
        "/help/documents-and-ai/how-vylan-checks-documents",
        "comment Vylan vérifie chaque document",
      ),
      ".",
    ),
  ],
};

export const articles = {
  "how-your-client-gets-their-link": howYourClientGetsTheirLink,
  "how-clients-upload": howClientsUpload,
};

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

// PRÉCISION : les rappels sont PAR COURRIEL SEULEMENT dans cet article, à
// dessein. src/lib/reminders.ts construit aussi un texto, mais src/lib/sms.ts
// ne fait rien du tout quand les variables Twilio sont absentes, et le
// fondateur a confirmé (2026-07-16) qu'elles ne sont PAS configurées en
// production. L'écran des réglages ne promet que le courriel, lui aussi.

export const meta: HelpCategoryMeta = {
  title: "Rappels et relances",
  description:
    "La partie qui harcèle à votre place. Comment les suivis automatiques fonctionnent, et comment changer leur moment, leur ton et leurs mots.",
};

const howRemindersWork: HelpArticle = {
  title: "Comment fonctionnent les rappels automatiques",
  summary:
    "Vylan écrit à votre client selon un calendrier tant que des documents manquent, et s'arrête tout seul dès que ce n'est plus le cas.",
  keywords: [
    "rappel",
    "rappels",
    "relance",
    "suivi",
    "automatique",
    "calendrier",
    "courriel",
    "arreter",
    "arrêter",
  ],
  body: [
    p(
      "C'est la partie du travail que personne ne facture : écrire à un client une quatrième fois pour le même feuillet. Vylan le fait à votre place, et lui n'est pas gêné.",
    ),

    h("Ce qui se passe après l'envoi"),
    p(
      "Vylan établit un calendrier de suivis. Chacun est un courriel à votre client avec son lien et ce qui manque encore. Vous ne faites rien.",
    ),

    h("Quand ça s'arrête"),
    p(
      "Les rappels s'arrêtent tout seuls. Vylan vérifie avant chaque envoi et le saute si :",
    ),
    list(
      ["L'engagement est terminé ou annulé."],
      ["Plus rien de requis n'est en attente."],
      ["Vous avez mis les rappels en pause sur cet engagement."],
    ),
    p(
      "Cette vérification se fait au moment de l'envoi, pas au moment où vous avez bâti le calendrier. Un client qui téléverse tout à 2 h du matin cesse donc d'avoir des nouvelles de Vylan immédiatement, sans que vous touchiez à quoi que ce soit.",
    ),
    note(
      "Vos réglages le disent clairement : ",
      ui(
        "Envoyer automatiquement un courriel au client tant que des documents requis sont manquants.",
      ),
    ),

    h("Seuls les documents requis comptent"),
    p(
      "Vylan relance les lignes requises. Une ligne optionnelle laissée vide ne fait pas continuer les courriels. Voyez ",
      link("/help/engagements/the-document-checklist", "la liste de documents"),
      ".",
    ),

    h("Un client sans adresse courriel"),
    warn(
      "Les rappels passent par courriel. Un client sans adresse au dossier ne peut pas les recevoir, et Vylan vous prévient sur l'engagement quand c'est le cas. Ajoutez une adresse avant qu'un rappel soit dû, sinon c'est un client que vous relancerez vous-même.",
    ),
    note(
      "Ensuite : ",
      link("/help/reminders/changing-reminders", "changer les rappels"),
      ".",
    ),
  ],
};

const changingReminders: HelpArticle = {
  title: "Changer les rappels",
  summary:
    "Fixez un calendrier par défaut pour tout le cabinet, puis pliez-le engagement par engagement. Vous contrôlez le moment, la fréquence, le ton et les mots.",
  keywords: [
    "personnaliser",
    "changer",
    "rappel",
    "calendrier",
    "ton",
    "pause",
    "defaut",
    "défaut",
    "jours",
    "repeter",
    "répéter",
    "objet",
  ],
  body: [
    p(
      "Le calendrier par défaut est un point de départ, pas une règle. Certains clients ont besoin de trois relances. D'autres n'en ont besoin d'aucune et seraient agacés par la première.",
    ),

    h("Le défaut de votre cabinet"),
    p(
      "Dans vos réglages, ",
      ui("Rappels automatiques par défaut"),
      " est le calendrier avec lequel chaque nouvel engagement démarre. Bâtissez-le une fois et il s'applique ensuite.",
    ),
    note(
      "Changer votre défaut ne touche pas les engagements qui existent déjà. Vylan le dit quand vous le modifiez : les engagements existants ne changeront pas.",
    ),

    h("Engagement par engagement"),
    p(
      "Ouvrez un engagement, trouvez ",
      ui("Rappels automatiques"),
      " et cliquez sur ",
      ui("Personnaliser les rappels"),
      ". Le défaut a été copié sur cet engagement à sa création : le modifier ici ne change que celui-là.",
    ),

    h("Ce que vous pouvez changer"),
    list(
      [
        strong("Le moment"),
        " : combien de jours après l'envoi, ou combien de jours après la date d'échéance.",
      ],
      [strong("La fréquence"), " : répéter un rappel un nombre de fois donné."],
      [
        strong("Le ton"),
        " : ",
        ui("Rappel amical"),
        ", ",
        ui("Rappel de suivi"),
        ", ",
        ui("Dernier rappel"),
        " ou ",
        ui("Rappel en retard"),
        ".",
      ],
      [
        strong("Les mots"),
        " : un objet et un message personnalisés, ou laissez-les vides pour ceux de Vylan.",
      ],
    ),

    h("Écrire les vôtres"),
    p(
      "Si vous écrivez un message personnalisé, vous pouvez y glisser des détails que Vylan remplit à l'envoi : le nom du client, l'engagement, votre cabinet, ce qui est encore en attente, et la date d'échéance. Une seule ligne de vous se lit donc comme si vous l'aviez écrite pour cette personne-là.",
    ),

    h("Voir quand ils partiront"),
    p(
      "Le calendrier vous montre les heures d'envoi estimées pendant que vous le bâtissez : pas de calcul de dates dans votre tête. Les rappels comptés à partir d'une date d'échéance en demandent une avant que Vylan puisse afficher les dates exactes.",
    ),

    h("Mettre en pause"),
    p(
      "Vous pouvez mettre les rappels en pause sur un engagement. Utile quand un client vous a dit qu'il était absent, ou quand vous êtes en pleine conversation et qu'une relance automatique de plus serait à côté de la plaque. Rien d'autre ne change dans l'engagement.",
    ),
  ],
};

export const articles = {
  "how-reminders-work": howRemindersWork,
  "changing-reminders": changingReminders,
};

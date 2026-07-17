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

// PRÉCISION DE VOCABULAIRE : en français, le produit dit « Administrateur » et
// « Membre » (Team.role_owner / role_staff). PAS « Propriétaire ». Le slug de
// l'article reste owners-and-members (les slugs sont anglais dans les deux
// langues, voir manifest.ts), mais le texte doit dire ce que l'écran dit.

export const meta: HelpCategoryMeta = {
  title: "Équipe et rôles",
  description:
    "Travailler avec des collègues. Activer le mode équipe, inviter du monde, qui peut faire quoi, et se répartir le travail.",
};

const turningOnTeamMode: HelpArticle = {
  title: "Activer le mode équipe",
  summary:
    "Le mode équipe ajoute les outils partagés : les collègues, l'attribution du travail et un registre de qui a fait quoi. C'est un interrupteur que vous activez quand vous le voulez.",
  keywords: [
    "equipe",
    "équipe",
    "mode equipe",
    "activer",
    "solo",
    "collaboration",
    "quitter",
  ],
  body: [
    p(
      "Un cabinet d'une seule personne n'a pas besoin d'une colonne indiquant à qui appartient un mandat. Vylan n'en montre donc pas tant que vous n'en voulez pas.",
    ),

    h("L'activer"),
    p(
      "Le mode équipe est un interrupteur dans vos réglages. Activez-le et les outils partagés apparaissent : une section équipe dans la barre latérale, l'attribution du travail sur les engagements et les clients, et des filtres pour votre propre travail.",
    ),
    note(
      "Vous n'avez pas besoin d'une deuxième personne d'abord. Activez-le pendant que vous êtes encore seul et tout est prêt pour le jour où quelqu'un se joint, y compris vous attribuer du travail à vous-même.",
    ),

    h("Le désactiver"),
    p(
      "Quitter le mode équipe cache tout ça de nouveau. Vylan ne vous laisse le faire que quand vous êtes réellement seul, pour que personne ne tire le tapis sous les pieds d'un collègue encore au travail.",
    ),
    note(
      "Ensuite : ",
      link("/help/team/inviting-teammates", "inviter des collègues"),
      ".",
    ),
  ],
};

const invitingTeammates: HelpArticle = {
  title: "Inviter des collègues",
  summary:
    "Envoyez une invitation par courriel. La personne crée son propre compte et arrive dans votre cabinet.",
  keywords: [
    "inviter",
    "collegue",
    "collègue",
    "membre",
    "utilisateur",
    "places",
    "courriel",
    "expire",
    "rejoindre",
  ],
  body: [
    h("Envoyer une invitation"),
    steps(
      ["Allez dans les réglages de votre équipe."],
      ["Cliquez sur ", ui("Inviter un membre"), "."],
      ["Entrez son adresse courriel."],
      [
        "Choisissez la ",
        ui("Langue de l'invitation"),
        ". Ça ne l'enferme pas : la personne pourra changer sa propre langue ensuite.",
      ],
      ["Cliquez sur ", ui("Envoyer l'invitation"), "."],
    ),
    p(
      "Elle reçoit un courriel pour créer son compte et rejoindre votre cabinet. Vylan vous dit qui a invité qui et quand chaque invitation expire : une invitation périmée saute aux yeux.",
    ),

    h("Si la personne utilise déjà Vylan"),
    p(
      "Quelqu'un qui a déjà un compte Vylan peut le déplacer dans votre cabinet. Comme ça veut dire quitter le cabinet où elle est, Vylan lui fait confirmer avec son mot de passe et lui explique d'abord ce qu'elle abandonne.",
    ),

    h("Les places"),
    p(
      "Vos réglages d'équipe affichent ",
      ui("2 sur 6 utilisateurs"),
      " pour que vous sachiez toujours où vous en êtes. Les cabinets ont une limite du nombre de personnes.",
    ),
    note(
      "Vous atteignez la limite et il vous faut de la place ? Écrivez à hello@vylan.app. Le prix est une conversation en ce moment, pas un bouton.",
    ),

    h("Retirer quelqu'un"),
    p(
      "Désactiver un collègue est immédiat : la personne perd l'accès et est déconnectée. Son activité passée reste dans vos dossiers, c'est le but, et vous pouvez la réactiver plus tard si elle revient.",
    ),
  ],
};

const ownersAndMembers: HelpArticle = {
  title: "Administrateurs et membres",
  summary:
    "Deux rôles. L'administrateur dirige le cabinet. Les membres font le travail. Voici exactement où passe la ligne.",
  keywords: [
    "role",
    "rôle",
    "roles",
    "administrateur",
    "membre",
    "permission",
    "acces",
    "accès",
    "transferer",
    "transférer",
  ],
  body: [
    p("Vylan a deux rôles aujourd'hui, volontairement simples."),

    h("Membre"),
    p(
      "Le rôle de travail. Les membres font tout ce que le mandat demande : créer des engagements, recueillir et réviser des documents, écrire aux clients, demander des signatures, facturer et terminer des mandats.",
    ),

    h("Administrateur"),
    p(
      "Tout ce qu'un membre peut faire, plus ce qui touche le cabinet lui-même :",
    ),
    list(
      ["Inviter et retirer des collègues."],
      ["Les réglages et l'image de marque du cabinet."],
      ["La facturation."],
      ["Le journal d'audit de tout le cabinet."],
      ["L'exportation de toutes les données du cabinet."],
    ),
    p("Il y a exactement un administrateur à la fois."),

    h("Le passer à quelqu'un d'autre"),
    p(
      "Vous pouvez transférer le rôle d'administrateur à un autre membre. Vylan est direct sur ce que ça veut dire : ",
      ui(
        "Le membre choisi devient l'administrateur (facturation, réglages, gestion de l'équipe), et vous devenez un membre régulier.",
      ),
    ),
    warn(
      "Vous ne pouvez pas le reprendre vous-même. Une fois transféré, c'est au nouvel administrateur de vous le rendre. Soyez sûr avant de confirmer.",
    ),

    h("Ce que tout le monde voit"),
    p(
      "Les deux rôles voient les clients et les engagements du cabinet. Vylan n'a pas d'engagements privés aujourd'hui : n'importe qui dans le cabinet peut ouvrir n'importe quel mandat. Si ce n'est pas ce qu'il vous faut, dites-le-nous à hello@vylan.app plutôt que de le contourner.",
    ),
  ],
};

const assigningWork: HelpArticle = {
  title: "Attribuer le travail et voir qui a fait quoi",
  summary:
    "Donnez un responsable à un engagement ou à un client pour que l'équipe sache sur quel bureau il est, et consultez le registre d'activité quand vous devez savoir ce qui s'est passé.",
  keywords: [
    "attribuer",
    "attribution",
    "responsable",
    "mes",
    "qui",
    "activite",
    "activité",
    "journal",
    "historique",
  ],
  body: [
    h("Attribuer"),
    p(
      "Avec le mode équipe activé, les engagements et les clients peuvent être attribués à une personne. Ce n'est pas un verrou, c'est une étiquette : tout le monde peut encore travailler sur tout, mais personne ne se demande à qui revient le mandat.",
    ),
    p(
      "Vous pouvez réattribuer à tout moment, ce qui est exactement ce qui arrive quand quelqu'un part en vacances.",
    ),

    h("Seulement mon travail"),
    p(
      "Vos listes peuvent filtrer sur ce qui vous est attribué : un cabinet partagé vous donne quand même une liste de tâches personnelle.",
    ),

    h("Qui a fait quoi"),
    p(
      "Les réglages d'équipe portent un registre de ce que votre équipe a fait. Il répond aux questions ordinaires : qui a approuvé ça, quand est-ce parti, qui a parlé à ce client en dernier.",
    ),
    note(
      "Les administrateurs ont aussi un journal d'audit plus complet, à l'échelle du cabinet, avec des filtres. Voyez ",
      link("/help/account/the-audit-log", "le journal d'audit"),
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

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

// SENSIBLE À LA CONFORMITÉ — voir en/e-signatures.ts pour les règles complètes.
// En résumé : plafonné à « légalement reconnues » + « piste de vérification
// infalsifiable ». Rien de plus fort, aucune affirmation juridique propre à une
// juridiction, et jamais de conseil juridique.
//
// Ces articles n'existent que parce que le fondateur a confirmé (2026-07-16)
// que SIGNWELL_TEST_MODE vaut exactement « false » en production. Par défaut
// le mode TEST produit des signatures FILIGRANÉES et SANS VALEUR LÉGALE. Si
// cet interrupteur repasse en test, supprimer ces deux articles le jour même.

export const meta: HelpCategoryMeta = {
  title: "Signatures électroniques",
  description:
    "Envoyer un document à signer, et comment votre client le signe sans rien imprimer.",
};

const requestingASignature: HelpArticle = {
  title: "Demander une signature",
  summary:
    "Téléversez un PDF sur un engagement et demandez à votre client de le signer. Il signe dans son navigateur, et la copie signée vous revient.",
  keywords: [
    "signature",
    "signer",
    "electronique",
    "électronique",
    "demander",
    "pdf",
    "lettre de mission",
    "autorisation",
  ],
  body: [
    p(
      "Les signatures vivent sur l'engagement, à côté des documents. Le même client, le même lien, la même conversation.",
    ),

    h("En envoyer une"),
    steps(
      ["Ouvrez l'engagement."],
      ["Demandez une signature et choisissez le PDF à signer, jusqu'à 25 Mo."],
      [
        "Envoyez. Votre client est averti, et le document apparaît sur son portail, à signer.",
      ],
    ),

    h("La suivre"),
    p("La demande porte son état sur l'engagement :"),
    list(
      [ui("Envoyé au client"), " : c'est chez lui."],
      [ui("En attente de signature"), " : toujours en attente."],
      [ui("Signé"), " : c'est fait."],
      [
        ui("Copie signée reçue"),
        " : le document complété est revenu et se télécharge.",
      ],
      [ui("Renvoyé"), " : vous l'avez retourné au client pour qu'il recommence."],
    ),
    p(
      "Un engagement en attente d'une signature se trouve à l'étape ",
      ui("En attente de signature"),
      " : votre liste montre après quoi il attend vraiment. Voyez ",
      link("/help/engagements/workflow-stages", "les étapes du mandat"),
      ".",
    ),

    h("Si ce n'est pas encore configuré"),
    p(
      "Si la signature n'a pas été configurée pour votre cabinet, la demande crée quand même la ligne sur la liste et affiche ",
      ui("Configuration de la signature requise"),
      ". Rien n'est perdu, et rien ne part chez votre client tant que ce n'est pas prêt.",
    ),

    h("Obtenir la copie signée"),
    p(
      "Une fois signé, ",
      ui("Télécharger le document signé"),
      " vous donne le PDF complété. Il est à vous, à classer où vous classez vos affaires.",
    ),

    h("S'il signe la mauvaise chose"),
    p(
      "Vous pouvez renvoyer une copie signée comme vous refuseriez n'importe quel document, avec une raison que votre client lit. Les raisons intégrées couvrent l'habituel : ",
      ui("Le document n'a pas été signé."),
      ", ",
      ui("Mauvais document."),
      ", ",
      ui("La copie signée est difficile à lire."),
    ),
    note(
      "Ensuite : ",
      link("/help/e-signatures/how-your-client-signs", "comment votre client signe"),
      ".",
    ),
  ],
};

const howYourClientSigns: HelpArticle = {
  title: "Comment votre client signe",
  summary:
    "Votre client signe dans son navigateur, sur la même page que le reste. Sans imprimer, sans numériser, sans compte.",
  keywords: [
    "signer",
    "client",
    "portail",
    "navigateur",
    "imprimer",
    "numeriser",
    "numériser",
    "legalement reconnue",
    "légalement reconnue",
    "piste de verification",
    "cellulaire",
  ],
  body: [
    p(
      "Ce que les clients redoutent, c'est imprimer une page, la signer, la numériser de travers et la renvoyer par courriel. Rien de tout ça ici.",
    ),

    h("Ce qu'il fait"),
    steps(
      ["Il ouvre son lien de portail, le même que pour téléverser."],
      ["Il voit une section ", ui("À signer"), " avec le document."],
      ["Il l'ouvre et signe dans le navigateur."],
      ["C'est tout. La copie signée vous revient automatiquement."],
    ),
    p(
      "Ça marche sur un cellulaire, ce qui compte plus qu'on pense. Beaucoup de signatures se font sur un divan.",
    ),

    h("Toujours pas de compte"),
    p(
      "Signer ne change pas l'entente. Pas de mot de passe, pas d'inscription, rien à installer. Le lien privé, c'est l'accès.",
    ),

    h("Une signature électronique, est-ce suffisant ?"),
    p(
      "Les signatures recueillies par Vylan sont légalement reconnues et accompagnées d'une piste de vérification infalsifiable qui consigne qui a signé, et quand.",
    ),
    note(
      "Savoir si un document donné devrait être signé électroniquement est un jugement professionnel qui appartient à votre cabinet, pas une question à laquelle Vylan peut répondre pour vous. Vylan fournit l'outil et la piste de vérification. Ce que vous en faites vous revient.",
    ),

    h("S'il téléverse plutôt une copie signée"),
    p(
      "Certains clients l'imprimeront quand même, par habitude. Le portail a ",
      ui("Téléverser la copie signée"),
      " justement pour ça : personne n'est coincé parce qu'il a fait à l'ancienne.",
    ),
  ],
};

export const articles = {
  "requesting-a-signature": requestingASignature,
  "how-your-client-signs": howYourClientSigns,
};

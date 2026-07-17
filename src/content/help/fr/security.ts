import {
  type HelpArticle,
  type HelpCategoryMeta,
  p,
  h,
  link,
  list,
  note,
} from "../types";

// SENSIBLE À LA CONFORMITÉ — les règles complètes sont en tête de
// en/security.ts. En résumé :
//   * JAMAIS « Vylan est certifié SOC 2 ». Uniquement « une infrastructure
//     conforme SOC 2 », et seulement là où c'est pertinent.
//   * « Données hébergées au Canada » est exact et encouragé.
//   * Signatures : plafonné à « légalement reconnues » + « piste de
//     vérification infalsifiable ».
//   * Rien sur les mécanismes de sécurité, l'architecture ou les clés : ce
//     n'est pas du contenu public.
//   * La Loi 25 est nommée comme la loi pour laquelle le produit est conçu.
//     Ça ne prétend PAS à une certification et ne doit jamais laisser croire
//     que Vylan donne un avis juridique.

export const meta: HelpCategoryMeta = {
  title: "Sécurité et données",
  description:
    "Où vivent les documents de vos clients, qui peut les atteindre, et ce qu'ils deviennent avec le temps.",
};

const whereYourDataLives: HelpArticle = {
  title: "Où vivent vos données",
  summary:
    "Vos données sont hébergées au Canada, sur une infrastructure conforme SOC 2 Type II.",
  keywords: [
    "donnees",
    "données",
    "canada",
    "hebergement",
    "hébergement",
    "serveur",
    "emplacement",
    "soc 2",
    "soc 2 type ii",
    "type 2",
    "supabase",
    "securite",
    "stockage",
  ],
  body: [
    p(
      "Vous détenez les documents fiscaux d'autres personnes. Savoir où ils se trouvent est une question légitime, et elle mérite une réponse courte.",
    ),

    h("Au Canada"),
    p("Vos données sont hébergées au Canada."),
    p(
      "Pour un cabinet canadien qui traite les dossiers financiers de clients canadiens, c'est habituellement la réponse qui compte, et c'est souvent la première chose qu'un client demande.",
    ),

    h("L'infrastructure"),
    p(
      "Vylan est bâti sur une infrastructure conforme SOC 2 Type II. Votre base de données et les fichiers téléversés par vos clients vivent sur Supabase, dans une région canadienne.",
    ),
    note(
      "Type II est la nuance à connaître si le vérificateur d'un client la demande. Un rapport de Type I dit que les contrôles étaient bien conçus un jour donné. Le Type II dit qu'ils ont été testés et qu'ils ont tenu sur une période.",
    ),

    h("Les récupérer"),
    p(
      "Vous pouvez télécharger tout ce que votre cabinet possède, quand vous voulez, sans nous le demander. Voyez ",
      link("/help/account/downloading-your-data", "télécharger toutes vos données"),
      ".",
    ),
    note(
      "Si un client ou un organisme a besoin de plus de détails que cette page n'en donne, écrivez à hello@vylan.app et une personne vous répondra franchement.",
    ),
  ],
};

const howClientAccessWorks: HelpArticle = {
  title: "Comment fonctionne l'accès client",
  summary:
    "Votre client utilise un lien privé plutôt qu'un mot de passe. Voici ce que ça veut dire, et ce qu'il peut ou ne peut pas atteindre.",
  keywords: [
    "acces",
    "accès",
    "lien",
    "mot de passe",
    "connexion",
    "securite",
    "sécurité",
    "prive",
    "privé",
    "partager",
    "client",
  ],
  body: [
    p(
      "Les clients n'ont pas de compte. Ils ont un lien privé. C'est un choix assumé, et ça vaut la peine de le comprendre plutôt que d'en être surpris.",
    ),

    h("Pourquoi pas de mot de passe"),
    p(
      "Parce que les mots de passe sont là où meurt la collecte de documents. Chaque compte que vous demandez à un client de créer est une raison de ne pas vous envoyer la chose. Le lien enlève ça, et c'est la principale raison pour laquelle les clients répondent vraiment.",
    ),

    h("Ce que le lien ouvre"),
    p("La page d'un seul client, pour le mandat que vous lui avez envoyé. Il peut y :"),
    list(
      ["Voir les documents que vous demandez."],
      ["Téléverser ses fichiers."],
      ["Signer ce que vous avez envoyé à signer."],
      ["Vous écrire."],
      ["Payer sa facture."],
      ["Télécharger le travail terminé."],
    ),
    p(
      "Il n'ouvre les documents de personne d'autre, et il n'ouvre pas le côté cabinet de Vylan.",
    ),

    h("Traitez-le comme une clé"),
    p(
      "Le lien est privé, et ce n'est pas une adresse publique que quelqu'un pourrait deviner. Mais quiconque le détient peut ouvrir cette page : ça vaut donc la peine de dire aux clients ce que vous diriez de n'importe quel lien privé, soit de ne pas le faire suivre.",
    ),
    note(
      "Vous pouvez toujours renvoyer un lien, et chaque rappel le contient à nouveau. Un client qui a perdu le sien, c'est l'affaire d'un instant, pas un dossier de soutien.",
    ),

    h("Votre propre compte, c'est autre chose"),
    p(
      "Rien de tout ça ne s'applique à vous. Le côté cabinet est un vrai compte avec un vrai mot de passe, et vous devriez activer la double authentification. Voyez ",
      link("/help/account/two-factor-login", "la connexion à deux facteurs"),
      ".",
    ),
  ],
};

const privacyAndLaw25: HelpArticle = {
  title: "Vie privée et Loi 25",
  summary:
    "Vylan est conçu pour les cabinets canadiens qui traitent des renseignements personnels, y compris sous la Loi 25 du Québec.",
  keywords: [
    "vie privee",
    "vie privée",
    "loi 25",
    "quebec",
    "québec",
    "renseignements personnels",
    "confidentialite",
    "conformite",
    "conformité",
    "consentement",
  ],
  body: [
    p(
      "Chaque document que vos clients vous envoient est un renseignement personnel, et la plupart sont du type sensible. Ça vient avec des obligations, et Vylan est bâti en les ayant en tête.",
    ),

    h("Conçu pour ça"),
    p(
      "Vylan est conçu pour les cabinets comptables canadiens qui traitent des renseignements personnels, y compris sous la Loi 25 du Québec. Vos données sont hébergées au Canada, sur une infrastructure conforme SOC 2 Type II.",
    ),

    h("Ce qui aide concrètement"),
    list(
      [
        "Les documents vont à un seul endroit plutôt que dans une boîte courriel qui n'oublie jamais rien.",
      ],
      ["Le lien de chaque client n'ouvre que sa propre page."],
      ["Un journal d'audit de ce qui s'est passé, quand, et par qui."],
      [
        "Les engagements supprimés sont définitivement retirés après 30 jours, fichiers compris.",
      ],
      ["Vous pouvez exporter tout ce que votre cabinet détient à tout moment."],
    ),

    h("Là où Vylan s'arrête"),
    note(
      "Vylan est un outil, pas un programme de conformité, et rien ici n'est un avis juridique. Vos obligations envers vos clients sont les vôtres : ce que vous recueillez, pourquoi, combien de temps vous le gardez, et ce que vous leur en dites. Nous pouvons vous dire où vivent les données et vous remettre le registre de ce qui s'est passé. Ce que vous devez à vos clients en vertu de la loi est une question pour vos propres conseillers.",
    ),

    h("La politique complète"),
    p(
      "Les détails sont dans ",
      link("/privacy", "notre politique de confidentialité"),
      ". Pour ce qu'elle ne couvre pas, écrivez à hello@vylan.app.",
    ),
  ],
};

export const articles = {
  "where-your-data-lives": whereYourDataLives,
  "how-client-access-works": howClientAccessWorks,
  "privacy-and-law-25": privacyAndLaw25,
};

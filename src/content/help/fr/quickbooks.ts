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

// Ces articles n'existent que parce que le fondateur a confirmé (2026-07-16)
// que QBO_ENVIRONMENT vaut « production » en production. Par défaut, ça bascule
// en SANDBOX, qui parle à une fausse entreprise de test Intuit et non aux vrais
// livres d'un client. Si l'interrupteur repasse en sandbox, ces articles
// deviennent faux et doivent être retirés le jour même.

export const meta: HelpCategoryMeta = {
  title: "QuickBooks",
  description:
    "Connectez QuickBooks en ligne et laissez Vylan transformer les documents que vous recueillez en transactions que vous approuvez.",
};

const connectingQuickbooks: HelpArticle = {
  title: "Connecter QuickBooks",
  summary:
    "Liez votre entreprise QuickBooks en ligne une fois. Réservé aux administrateurs, et vous pouvez vous déconnecter quand vous voulez.",
  keywords: [
    "quickbooks",
    "qbo",
    "intuit",
    "connecter",
    "integration",
    "intégration",
    "lier",
    "deconnecter",
    "déconnecter",
    "comptabilite",
  ],
  body: [
    p(
      "Si vous tenez les livres de vos clients dans QuickBooks en ligne, Vylan peut porter ce qu'il recueille jusqu'au bout, au lieu que vous retapiez un relevé bancaire dans un registre.",
    ),

    h("Se connecter"),
    steps(
      ["Allez dans vos réglages et ouvrez les intégrations."],
      ["Lancez la connexion QuickBooks."],
      [
        "Connectez-vous à Intuit et approuvez la connexion. Ça se passe du côté d'Intuit.",
      ],
      ["Vous revenez dans Vylan, connecté."],
    ),
    note(
      "Réservé aux administrateurs. Connecter des livres est une décision qui engage le cabinet. Voyez ",
      link("/help/team/owners-and-members", "administrateurs et membres"),
      ".",
    ),

    h("Ce que Vylan récupère"),
    p(
      "Une fois connecté, Vylan lit les listes dont il a besoin pour parler la langue de votre client : ses comptes, ses clients, ses fournisseurs et ses codes de taxe. C'est ce qui permet à une suggestion de dire ",
      ui("Fournitures de bureau"),
      " au lieu de deviner une catégorie qui n'existe pas dans ses livres.",
    ),

    h("Se déconnecter"),
    p(
      "Déconnectez-vous du même endroit, quand vous voulez. Vylan cesse de lire et cesse de publier.",
    ),
    note(
      "Ensuite : ",
      link("/help/quickbooks/how-suggestions-work", "comment Vylan suggère des transactions"),
      ".",
    ),
  ],
};

const howSuggestionsWork: HelpArticle = {
  title: "Comment Vylan suggère des transactions",
  summary:
    "Vylan lit les documents que vous avez recueillis, en extrait les transactions et propose où chacune va. Propose.",
  keywords: [
    "suggestion",
    "suggestions",
    "transaction",
    "extraire",
    "recu",
    "reçu",
    "releve bancaire",
    "relevé bancaire",
    "categoriser",
    "catégoriser",
    "apprendre",
    "ia",
  ],
  body: [
    p(
      "Votre client téléverse une pile de reçus et un relevé bancaire. Ce sont des données prisonnières d'images. Vylan les lit, en sort les transactions, et détermine où chacune appartient probablement dans ses livres.",
    ),

    h("Ce qu'il détermine"),
    list(
      ["Les transactions du document : date, montant, avec qui."],
      ["Le compte auquel chacune appartient vraisemblablement."],
      [
        "Le client ou le fournisseur, apparié avec ceux qui existent réellement dans ses livres.",
      ],
      ["Le code de taxe."],
    ),

    h("Il propose, vous décidez"),
    warn(
      "Rien n'atteint les livres de votre client sans votre approbation. Vylan produit des brouillons. Un brouillon est une suggestion qui attend dans une file, et ça reste une suggestion tant que vous n'en décidez pas autrement.",
    ),

    h("Il apprend de vous"),
    p(
      "Quand vous corrigez une suggestion, Vylan s'en souvient. Corrigez le même fournisseur deux fois et il cesse de se tromper. La file devient plus tranquille à mesure que vous l'utilisez, et c'est toute l'idée.",
    ),
    note(
      "Ensuite : ",
      link("/help/quickbooks/reviewing-drafts", "réviser les brouillons"),
      ".",
    ),
  ],
};

const reviewingDrafts: HelpArticle = {
  title: "Réviser les brouillons",
  summary:
    "La file de brouillons est là où les suggestions vous attendent. Approuvez les bonnes, corrigez celles qui sont proches, jetez le reste.",
  keywords: [
    "brouillon",
    "brouillons",
    "file",
    "reviser",
    "réviser",
    "approuver",
    "refuser",
    "corriger",
  ],
  body: [
    p(
      "Tout ce que Vylan détermine arrive dans une seule file, au lieu de s'éparpiller entre les engagements. Vous vous assoyez une fois et vous la videz.",
    ),

    h("S'y rendre"),
    p(
      "La file de brouillons est dans votre barre latérale, sous les intégrations, une fois QuickBooks connecté.",
    ),

    h("Ce que vous en faites"),
    list(
      ["L'approuver, si Vylan a vu juste."],
      [
        "La corriger d'abord, si elle est proche. Votre correction est aussi la façon dont il apprend.",
      ],
      ["La refuser, si ce n'est pas quelque chose qui a sa place dans les livres."],
    ),

    h("D'où vient chaque brouillon"),
    p(
      "Chaque brouillon pointe vers le document dont il vient : « c'est quoi ce 340 $ » est un clic, pas une chasse dans un dossier.",
    ),

    h("Rien ne bouge sans vous"),
    p(
      "Un brouillon est inerte. Il attend dans la file jusqu'à votre approbation. Laisser la file tranquille une semaine ne change rien dans les livres de votre client.",
    ),
    note(
      "Ensuite : ",
      link("/help/quickbooks/posting-to-quickbooks", "publier vers QuickBooks"),
      ".",
    ),
  ],
};

const postingToQuickbooks: HelpArticle = {
  title: "Publier vers QuickBooks",
  summary:
    "Les brouillons approuvés entrent dans les vrais livres de votre client. Ce qui se passe, et quoi faire quand un ne passe pas.",
  keywords: [
    "publier",
    "envoyer",
    "synchroniser",
    "quickbooks",
    "livres",
    "echec",
    "échec",
    "erreur",
    "doublon",
  ],
  body: [
    p(
      "Approuver un brouillon, c'est le moment où il devient réel. Vylan l'écrit dans l'entreprise QuickBooks que vous avez connectée.",
    ),

    h("Ce qui atterrit"),
    p(
      "La transaction, avec le compte, le client ou le fournisseur, et le code de taxe que vous avez approuvés. Elle apparaît dans QuickBooks comme vous l'auriez tapée, sans la frappe.",
    ),

    h("Vous pouvez suivre"),
    p(
      "Chaque brouillon porte son état : vous voyez ce qui a été publié et ce qui ne l'a pas été. Un brouillon publié est réglé et quitte votre file.",
    ),

    h("Quand un ne passe pas"),
    p(
      "Parfois QuickBooks refuse. Un compte a été renommé, un client supprimé, quelque chose a changé de leur côté depuis la dernière lecture de Vylan. Le brouillon reste dans votre file avec ce qui s'est produit, au lieu de disparaître en laissant un trou dans les livres.",
    ),
    p("Réglez la cause dans QuickBooks, puis approuvez-le à nouveau."),

    h("Les doublons"),
    p(
      "Vylan vérifie ce qui est déjà au registre avant de proposer quelque chose : le même reçu téléversé deux fois ne devient pas deux transactions.",
    ),
    warn(
      "Ça reste le grand livre de votre client. Vylan est prudent, mais c'est vous le comptable, et la file de brouillons existe justement pour qu'une personne regarde chaque ligne avant qu'elle atterrisse.",
    ),
  ],
};

export const articles = {
  "connecting-quickbooks": connectingQuickbooks,
  "how-suggestions-work": howSuggestionsWork,
  "reviewing-drafts": reviewingDrafts,
  "posting-to-quickbooks": postingToQuickbooks,
};

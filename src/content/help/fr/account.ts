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

export const meta: HelpCategoryMeta = {
  title: "Compte et réglages",
  description:
    "Votre profil, l'allure de votre cabinet, comment vous vous connectez, et comment sortir toutes vos données quand vous le voulez.",
};

const yourProfile: HelpArticle = {
  title: "Votre profil",
  summary: "Votre nom, votre photo, et comment vous vous connectez.",
  keywords: [
    "profil",
    "nom",
    "avatar",
    "photo",
    "compte",
    "mot de passe",
  ],
  body: [
    p(
      "Votre profil, c'est la moitié personnelle de vos réglages. Ceux de votre cabinet sont ailleurs, voyez ",
      link("/help/account/firm-branding", "l'image de marque du cabinet"),
      ".",
    ),

    h("Nom et photo"),
    p(
      "Définissez votre nom affiché et téléversez une photo. Vos collègues voient les deux, sur les attributions et dans le registre d'activité : c'est ce qui fait qu'un cabinet partagé ressemble à des personnes plutôt qu'à des lignes.",
    ),

    h("Se connecter"),
    p(
      "Vous pouvez vous connecter avec Google, ou avec un courriel et un mot de passe. Peu importe lequel, activer la double authentification est la meilleure chose que vous puissiez faire pour votre compte. Voyez ",
      link("/help/account/two-factor-login", "la connexion à deux facteurs"),
      ".",
    ),
  ],
};

const twoFactorLogin: HelpArticle = {
  title: "La connexion à deux facteurs",
  summary:
    "Ajoutez une deuxième étape à la connexion, pour qu'un mot de passe volé ne suffise pas. Conservez les codes de secours.",
  keywords: [
    "2fa",
    "double authentification",
    "deux facteurs",
    "authentification",
    "securite",
    "sécurité",
    "codes de secours",
    "verrouille",
  ],
  body: [
    p(
      "Vous détenez les documents fiscaux d'autres personnes. La double authentification, c'est la différence entre quelqu'un qui a votre mot de passe et quelqu'un qui a la paperasse de vos clients.",
    ),

    h("L'activer"),
    steps(
      ["Allez dans votre profil et trouvez la section sécurité."],
      ["Lancez la configuration. Un code QR apparaît."],
      [
        "Scannez-le avec une application d'authentification : Google Authenticator, 1Password, Authy, celle que vous utilisez déjà.",
      ],
      ["Entrez le code à six chiffres qu'elle affiche, pour prouver que ça marche."],
      [
        "Conservez vos codes de secours en lieu sûr. Voir plus bas, c'est la partie importante.",
      ],
    ),
    p(
      "À partir de là, la connexion demande un code de votre application en plus de votre mot de passe.",
    ),

    h("Les codes de secours"),
    warn(
      "Les codes de secours sont votre seule façon de rentrer si vous perdez votre téléphone. Pas un billet de soutien, pas un courriel chez nous. Conservez-les ailleurs que sur votre téléphone : un gestionnaire de mots de passe, ou sur papier dans un tiroir. Les gens sautent cette étape puis perdent leur téléphone, et c'est une journée sincèrement mauvaise.",
    ),
    p(
      "Chaque code sert une fois. Si vous en utilisez, générez-en une nouvelle série.",
    ),

    h("Si vous perdez votre téléphone"),
    p(
      "Connectez-vous avec un code de secours, puis reconfigurez la double authentification sur votre nouveau téléphone.",
    ),
  ],
};

const firmBranding: HelpArticle = {
  title: "L'image de marque du cabinet",
  summary:
    "Votre logo et votre couleur, sur la page que vos clients voient et dans les courriels qu'ils reçoivent. À faire une fois.",
  keywords: [
    "marque",
    "logo",
    "couleur",
    "cabinet",
    "portail",
    "courriel",
    "accent",
  ],
  body: [
    p(
      "Votre client devrait sentir qu'il traite avec votre cabinet, parce que c'est le cas. Ce n'est pas le nom de Vylan qui doit être sur cette page.",
    ),

    h("Ce que vous définissez"),
    p("Dans les réglages de votre cabinet :"),
    list(
      [ui("Nom du cabinet"), " : le nom sous lequel vos clients vous connaissent."],
      [ui("Logo"), " : apparaît sur le portail."],
      [ui("Couleur de marque"), " : l'accent sur le portail et dans vos courriels."],
    ),

    h("Où ça paraît"),
    p(
      "Sur le portail de votre client et dans les courriels que Vylan envoie en votre nom. La salutation qu'il lit nomme votre cabinet, pas nous : ",
      ui("Voici les documents dont Lavoie CPA a besoin."),
    ),
    note(
      "Choisissez une couleur assez contrastée pour se lire sur du blanc. Si celle par défaut ne vous nuit pas, la laisser tranquille est une très bonne décision.",
    ),
  ],
};

const languageAndTheme: HelpArticle = {
  title: "Langue, thème et fuseau horaire",
  summary:
    "Comment régler vos propres préférences de travail, et pourquoi votre langue et celle de votre client sont séparées.",
  keywords: [
    "langue",
    "francais",
    "français",
    "anglais",
    "theme",
    "thème",
    "mode sombre",
    "fuseau horaire",
    "preferences",
    "préférences",
  ],
  body: [
    h("La langue"),
    p(
      "Choisissez le français ou l'anglais pour votre propre interface. Ça change immédiatement.",
    ),
    p(
      "C'est la vôtre, à vous seul. Chaque client est contacté dans sa propre langue, peu importe celle dans laquelle vous travaillez : un comptable anglophone peut servir un client francophone et les deux lisent tout dans leur langue.",
    ),

    h("Le thème"),
    p(
      "Clair ou sombre pour l'application, ou suivez le réglage de votre ordinateur. Vos clients ont leur propre bascule clair/sombre sur leur portail.",
    ),

    h("Le fuseau horaire"),
    p(
      "Réglez votre fuseau pour que les dates et les heures se lisent correctement, et pour que les rappels arrivent à une heure raisonnable plutôt qu'au milieu de la nuit.",
    ),
  ],
};

const downloadingYourData: HelpArticle = {
  title: "Télécharger toutes vos données",
  summary:
    "Sortez tout ce que votre cabinet possède de Vylan quand vous voulez. Des chiffriers et tous les fichiers, en un seul téléchargement.",
  keywords: [
    "export",
    "exporter",
    "telecharger",
    "télécharger",
    "sauvegarde",
    "donnees",
    "données",
    "csv",
    "zip",
    "partir",
  ],
  body: [
    p(
      "Vos données sont à vous. Pas dans l'abstrait : il y a un bouton, et il vous les donne toutes.",
    ),

    h("Comment"),
    p(
      "Allez dans vos réglages, trouvez la section des données, et téléchargez les données de votre cabinet. Vous obtenez un fichier ZIP contenant des chiffriers de vos dossiers et tous les fichiers que vos clients ont téléversés.",
    ),
    note(
      "Réservé aux administrateurs, puisque c'est tout le cabinet dans un seul fichier. Voyez ",
      link("/help/team/owners-and-members", "administrateurs et membres"),
      ".",
    ),

    h("Pourquoi vous le feriez"),
    list(
      ["Une sauvegarde que vous gardez vous-même."],
      ["Le comptable de votre comptable veut des dossiers."],
      ["Vous partez ailleurs, et vous aimeriez partir avec votre travail."],
    ),
    p(
      "Le dernier point est voulu. Pouvoir partir, c'est la raison de faire confiance en restant.",
    ),

    h("Juste un client"),
    p(
      "Vous n'avez pas besoin de tout pour trouver une chose. L'archive de n'importe quel client se télécharge fichier par fichier, et chaque engagement a un téléchargement complet. Voyez ",
      link("/help/clients/the-client-archive", "l'archive des documents du client"),
      ".",
    ),
  ],
};

const theAuditLog: HelpArticle = {
  title: "Le journal d'audit",
  summary:
    "Un registre, à l'échelle du cabinet, de ce qui s'est passé, quand, et par qui. Réservé aux administrateurs.",
  keywords: [
    "audit",
    "journal",
    "historique",
    "qui",
    "activite",
    "activité",
    "registre",
    "conformite",
    "filtre",
  ],
  body: [
    p(
      "Le journal d'audit répond aux questions après coup. Qui a approuvé ce document. Quand est-ce parti chez le client. Qu'est-il arrivé à cet engagement mardi dernier.",
    ),

    h("S'y rendre"),
    p(
      "Vos réglages, sous le journal d'audit. C'est réservé aux administrateurs, parce que ça couvre tout le monde dans le cabinet.",
    ),

    h("Ce qu'on y trouve"),
    p(
      "L'activité de tout le cabinet, avec des filtres : vous pouvez cibler une personne, un type d'événement ou une période au lieu de faire défiler.",
    ),

    h("Journal d'audit ou registre d'activité ?"),
    p(
      "Vos réglages d'équipe ont un panneau « qui a fait quoi » plus léger, que n'importe quel collègue peut lire. Le journal d'audit est la version complète, filtrable, réservée aux administrateurs. Voyez ",
      link("/help/team/assigning-work", "attribuer le travail et voir qui a fait quoi"),
      ".",
    ),
  ],
};

export const articles = {
  "your-profile": yourProfile,
  "two-factor-login": twoFactorLogin,
  "firm-branding": firmBranding,
  "language-and-theme": languageAndTheme,
  "downloading-your-data": downloadingYourData,
  "the-audit-log": theAuditLog,
};

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
  title: "Clients",
  description:
    "Les gens pour qui vous travaillez. Les ajouter, importer une liste que vous avez déjà, et retrouver un document d'il y a trois ans.",
};

const addingClients: HelpArticle = {
  title: "Ajouter et gérer vos clients",
  summary:
    "Un client, c'est une personne ou une entreprise pour qui vous travaillez. Tout ce que vous avez recueilli d'elle est rattaché à sa fiche.",
  keywords: [
    "client",
    "clients",
    "ajouter",
    "nouveau",
    "contact",
    "courriel",
    "telephone",
    "téléphone",
    "recherche",
    "trier",
    "doublon",
  ],
  body: [
    p(
      "Les clients sont la colonne vertébrale de Vylan. Chaque engagement appartient à un client, chaque document appartient à un engagement : la fiche d'un client accumule donc tranquillement tout l'historique de votre relation.",
    ),

    h("En ajouter un"),
    p(
      "Cliquez sur ",
      ui("+ Ajouter un client"),
      " sur votre page Clients. Il vous faut un nom et une adresse courriel. Le courriel est important : c'est là que part son lien privé.",
    ),
    p(
      "Vous pouvez aussi créer un client pendant la création d'un engagement, sans casser votre élan.",
    ),

    h("En retrouver un"),
    p(
      "La liste des clients offre la recherche, le tri et un filtre pour les clients actifs seulement. La recherche ignore les accents : ",
      ui("Etienne"),
      " trouve ",
      ui("Étienne"),
      ", ce qui compte quand on tape vite.",
    ),
    p(
      "Cliquer sur un client le déplie sur place pour montrer ses engagements. Vous ne perdez pas votre liste pour vérifier une seule chose.",
    ),

    h("Les doublons"),
    p(
      "Vylan remarque quand vous êtes sur le point d'ajouter quelqu'un qui ressemble à une fiche existante, et vous le dit avant que vous vous retrouviez avec deux fois la même personne.",
    ),

    h("Tout son historique"),
    p(
      "Chaque client a une archive de documents qui remonte aussi loin que votre utilisation de Vylan. Voyez ",
      link("/help/clients/the-client-archive", "l'archive des documents du client"),
      ".",
    ),
    note(
      "Vous avez déjà une liste ? ",
      link("/help/clients/importing-clients", "Importez-la depuis un chiffrier"),
      " plutôt que de la retaper.",
    ),
  ],
};

const importingClients: HelpArticle = {
  title: "Importer vos clients depuis un chiffrier",
  summary:
    "Amenez toute votre liste de clients d'un coup à partir d'un fichier CSV, au lieu de les saisir un à un.",
  keywords: [
    "import",
    "importer",
    "csv",
    "chiffrier",
    "excel",
    "tableur",
    "en lot",
    "migrer",
    "liste",
  ],
  body: [
    p(
      "Personne ne retape deux cents clients. Si vous les avez dans un chiffrier, et tout le monde les a, apportez le fichier.",
    ),

    h("Comment faire"),
    steps(
      ["Allez sur votre page Clients et choisissez ", ui("Importer un CSV"), "."],
      ["Téléversez votre fichier."],
      ["Vérifiez ce que Vylan vous relit."],
      ["Confirmez. Vos clients sont entrés."],
    ),

    h("Préparer le fichier"),
    p(
      "Un CSV, c'est ce que donne ",
      ui("Enregistrer sous"),
      " ou ",
      ui("Exporter"),
      " dans Excel, Numbers ou Google Sheets. Une ligne par client, avec au minimum un nom et une adresse courriel.",
    ),
    note(
      "Nettoyez le chiffrier avant l'import plutôt qu'après. Corriger une colonne dans Excel prend une minute. Corriger deux cents fiches à la main, non.",
    ),

    h("Les doublons"),
    p(
      "Importer une liste qui recoupe des clients que vous avez déjà est normal, et Vylan signale le recoupement au lieu de dédoubler tout le monde en silence.",
    ),
  ],
};

const theClientArchive: HelpArticle = {
  title: "L'archive des documents du client",
  summary:
    "Tous les documents que vous avez recueillis d'un client, au même endroit, avec une recherche. Fait pour la demande qui commence par « auriez-vous encore ».",
  keywords: [
    "archive",
    "historique",
    "ancien",
    "passe",
    "passé",
    "trouver",
    "recherche",
    "telecharger",
    "télécharger",
    "annee",
    "année",
  ],
  body: [
    p(
      "Un client appelle et a besoin de l'avis de cotisation que vous avez recueilli il y a deux ans. C'est exactement à ça que sert l'archive.",
    ),

    h("S'y rendre"),
    p("Ouvrez un client et allez à son archive de documents."),

    h("Ce qu'on y trouve"),
    p(
      "Tout, regroupé par engagement, aussi loin que remonte votre utilisation de Vylan :",
    ),
    list(
      ["Les documents qu'il a téléversés."],
      ["Ce qu'il a signé."],
      ["Le travail terminé que vous lui avez renvoyé."],
    ),

    h("Retrouver une seule chose"),
    p(
      "Un historique de cinq ans n'est utile que si on peut le trancher. L'archive offre donc :",
    ),
    list(
      [
        "Une recherche sur les noms de fichiers et les titres d'engagements, sans tenir compte des accents.",
      ],
      ["Un tri par plus récent, plus ancien ou par nom."],
      ["Un filtre par catégorie."],
      ["Tout déplier ou tout replier d'un coup."],
    ),
    p(
      "Les compteurs suivent les filtres : ce que vous voyez correspond à ce qui a été trouvé.",
    ),

    h("En sortir une copie"),
    p(
      "Téléchargez n'importe quel fichier directement depuis l'archive. Pour tout un engagement, il y a un téléchargement complet sur l'engagement lui-même, et vous pouvez exporter tout ce que votre cabinet possède depuis vos réglages. Voyez ",
      link("/help/account/downloading-your-data", "télécharger toutes vos données"),
      ".",
    ),
  ],
};

export const articles = {
  "adding-clients": addingClients,
  "importing-clients": importingClients,
  "the-client-archive": theClientArchive,
};

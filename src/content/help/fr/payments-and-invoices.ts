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
  title: "Paiements et factures",
  description:
    "Être payé sans quitter Vylan. Connecter Stripe, facturer, comment votre client paie, et retenir le travail terminé jusqu'au règlement.",
};

const connectingStripe: HelpArticle = {
  title: "Connecter Stripe pour être payé",
  summary:
    "Connectez un compte Stripe une fois et vos clients peuvent vous payer depuis leur portail. L'argent va dans votre banque, pas dans la nôtre.",
  keywords: [
    "stripe",
    "connecter",
    "paiement",
    "banque",
    "carte",
    "configuration",
    "etre paye",
    "être payé",
  ],
  body: [
    p(
      "Vylan recueille les documents, alors autant qu'il recueille les honoraires. Connectez Stripe une fois et chaque engagement peut porter une facture que votre client paie en deux clics.",
    ),

    h("Ce que la connexion veut dire"),
    p(
      "Vos clients vous paient, vous. L'argent arrive dans votre compte bancaire via votre propre compte Stripe. Vylan n'est pas un intermédiaire qui retient vos honoraires.",
    ),

    h("La mise en place"),
    steps(
      ["Allez dans vos réglages et ouvrez la section des paiements."],
      ["Lancez la connexion Stripe. Vous serez dirigé vers le parcours de Stripe."],
      [
        "Donnez à Stripe ce qu'il demande : vos informations d'entreprise et le compte bancaire où vous voulez être payé. Ça se passe entre vous et Stripe.",
      ],
      ["Revenez dans Vylan. La connexion s'affiche comme active."],
    ),
    note(
      "C'est Stripe qui décide de ce qu'il doit vérifier, et du temps que ça prend. C'est habituellement rapide, mais un nouveau compte peut rester en révision un moment. C'est le processus de Stripe, pas celui de Vylan.",
    ),

    h("Tant que ce n'est pas connecté"),
    p(
      "Tout le reste fonctionne normalement. Vous pouvez recueillir des documents, les réviser et terminer des mandats. Votre client ne verra simplement pas de moyen de payer en ligne. S'il arrive sur une page de paiement avant que vous soyez prêt, on lui dit de vous contacter pour convenir du paiement plutôt que de le laisser dans un cul-de-sac.",
    ),
    note(
      "Ensuite : ",
      link("/help/payments-and-invoices/creating-an-invoice", "créer une facture"),
      ".",
    ),
  ],
};

const creatingAnInvoice: HelpArticle = {
  title: "Créer et envoyer une facture",
  summary:
    "Ajoutez une facture à un engagement et votre client la paie depuis la page même où il vous a envoyé ses documents.",
  keywords: [
    "facture",
    "facturer",
    "montant",
    "envoyer",
    "impaye",
    "impayé",
    "paye",
    "payé",
    "honoraires",
  ],
  body: [
    p(
      "Une facture appartient à un engagement. C'est le but : votre client ne fouille pas ses courriels pour trouver une facture qui concerne un mandat dont il vous parle déjà au même endroit.",
    ),

    h("En ajouter une"),
    steps(
      ["Ouvrez l'engagement."],
      ["Ajoutez une facture et fixez le montant."],
      [
        "Envoyez-la. Votre client la voit sur son portail, et elle lui parvient aussi par courriel.",
      ],
    ),

    h("La suivre"),
    p(
      "La facture reste sur l'engagement avec son état : ",
      ui("Impayée"),
      " jusqu'au règlement, ",
      ui("Payée"),
      " une fois l'argent passé. Vous n'avez pas à rapprocher ça à la main : Stripe le dit à Vylan et l'engagement se met à jour tout seul.",
    ),
    p(
      "Un engagement dont la facture est sortie se trouve à l'étape ",
      ui("En attente de paiement"),
      " : votre liste montre qu'il attend après l'argent, pas après vous. Voyez ",
      link("/help/engagements/workflow-stages", "les étapes du mandat"),
      ".",
    ),

    h("Quand il faut laisser aller"),
    p(
      "Toutes les factures ne sont pas payées, et toutes ne devraient pas être relancées. Vous pouvez annuler une facture : ça règle la question sans transfert d'argent et déverrouille ce qui était retenu derrière.",
    ),
    note(
      "Il faut Stripe connecté pour qu'un client paie en ligne. Voyez ",
      link("/help/payments-and-invoices/connecting-stripe", "connecter Stripe"),
      ".",
    ),
  ],
};

const howYourClientPays: HelpArticle = {
  title: "Comment votre client paie",
  summary:
    "Votre client paie depuis son portail, par carte. Sans compte, sans application, et le reçu est immédiat.",
  keywords: [
    "payer",
    "paiement",
    "carte",
    "client",
    "portail",
    "recu",
    "reçu",
    "echoue",
    "échoué",
    "securise",
    "sécurisé",
  ],
  body: [
    p(
      "Le même lien privé que votre client utilise pour téléverser ses documents est celui où il paie. Rien de nouveau à apprendre, rien de nouveau à créer.",
    ),

    h("Ce qu'il voit"),
    p(
      "Un bloc de paiement apparaît sur sa page : ",
      ui("Paiement dû"),
      ", le montant, le nom de votre cabinet et un bouton ",
      ui("Payer maintenant"),
      ". C'est marqué ",
      ui("Paiement sécurisé par Stripe"),
      ", parce que c'est Stripe qui traite la carte.",
    ),
    p(
      "Quand ça passe, il voit ",
      ui("Paiement reçu"),
      " et un remerciement, immédiatement. Il peut télécharger la facture pour ses dossiers à tout moment.",
    ),

    h("Les données de carte ne touchent jamais Vylan"),
    p(
      "Le paiement est traité par Stripe de bout en bout. On dit à Vylan si un paiement a réussi. Il ne voit jamais la carte de votre client et ne la conserve pas.",
    ),

    h("Quand un paiement échoue"),
    p(
      "Des cartes sont refusées. Vylan le dit clairement et offre ",
      ui("Réessayer"),
      " plutôt que de laisser votre client devant une erreur. Si vous n'êtes pas encore configuré pour recevoir des paiements, on lui dit de vous contacter pour convenir du paiement.",
    ),
    note(
      "Vous pouvez aussi retenir le travail terminé jusqu'au règlement de la facture. Voyez ",
      link("/help/payments-and-invoices/the-invoice-lock", "le verrou de facture"),
      ".",
    ),
  ],
};

const theInvoiceLock: HelpArticle = {
  title: "Le verrou de facture",
  summary:
    "Retenez les documents finaux jusqu'au paiement. Votre client peut toujours téléverser et signer. Seul le travail terminé attend.",
  keywords: [
    "verrou",
    "verrouiller",
    "retenir",
    "impaye",
    "impayé",
    "liberer",
    "libérer",
    "documents finaux",
  ],
  body: [
    p(
      "Chaque cabinet a eu le client qui devient silencieux dès que la déclaration est entre ses mains. Le verrou de facture est fait pour ça.",
    ),

    h("Ce qu'il fait"),
    p(
      "Activez ",
      ui("Verrouiller les documents finaux jusqu'au paiement de la facture"),
      " et le travail terminé que vous renvoyez reste verrouillé sur le portail de votre client jusqu'au règlement. Dès que c'est payé, ça se déverrouille tout seul. Vous n'avez pas à surveiller.",
    ),

    h("Ce qu'il ne fait pas"),
    p("C'est volontairement étroit, et le produit le dit sur l'interrupteur :"),
    p(
      ui(
        "Votre client peut toujours téléverser et signer. Seuls les documents finaux que vous lui envoyez restent verrouillés jusqu'au paiement.",
      ),
    ),
    p(
      "Votre client n'est donc jamais barré hors de sa propre paperasse. Il peut encore vous envoyer des choses, encore signer, encore lire la conversation. La seule chose derrière le verrou, c'est le produit fini.",
    ),

    h("Ce que votre client voit"),
    p(
      "Pas un mur. Ses documents terminés sont visiblement là, marqués ",
      ui("Verrouillés jusqu'au paiement"),
      ", avec une ligne qui lui dit qu'ils seront disponibles dès le règlement de la facture. Il sait exactement ce qu'il obtient et exactement quoi faire.",
    ),

    h("Laisser passer"),
    p(
      "Vous pouvez déverrouiller un document à la main à tout moment sans être payé, et annuler la facture entièrement. Le verrou est un réglage par défaut, pas une cage. Un client avec une vraie raison ne devrait pas avoir à vous appeler deux fois.",
    ),
    warn(
      "Réfléchissez à qui vous l'activez. C'est le bon outil pour un client qui a un historique. C'est un drôle d'accueil pour celui qui a toujours payé à temps.",
    ),
    note(
      "Ensuite : ",
      link(
        "/help/payments-and-invoices/sending-final-documents",
        "renvoyer les documents finaux",
      ),
      ".",
    ),
  ],
};

const sendingFinalDocuments: HelpArticle = {
  title: "Renvoyer les documents finaux",
  summary:
    "Téléversez le travail terminé sur l'engagement et votre client le télécharge depuis la page où il a téléversé. Sans pièce jointe, sans courriel refusé pour cause de taille.",
  keywords: [
    "final",
    "finaux",
    "livrable",
    "renvoyer",
    "termine",
    "terminé",
    "telecharger",
    "télécharger",
    "pdf",
    "note",
  ],
  body: [
    p(
      "Le mandat se termine là où il a commencé : sur le portail de votre client. Vous téléversez le travail fini, il le télécharge. Aucune pièce jointe qui rebondit, aucun troisième outil de partage.",
    ),

    h("En envoyer un"),
    steps(
      ["Ouvrez l'engagement et trouvez ", ui("Documents finaux"), "."],
      ["Cliquez sur ", ui("Téléverser"), " et choisissez le fichier."],
      ["Ajoutez une note si ça demande du contexte. Optionnel, mais ça aide souvent."],
      ["Téléversez. Votre client peut le télécharger depuis son portail."],
    ),

    h("Ce que vous pouvez envoyer"),
    list(
      ["Des PDF et des images."],
      ["Jusqu'à 25 Mo par fichier."],
      ["Autant que le mandat en demande."],
    ),

    h("La note"),
    p(
      "La note accompagne le document dans le portail de votre client. Ça vaut la peine de s'en servir. ",
      ui("Signez la page 3 et renvoyez-la"),
      " évite le courriel que vous recevriez demain. Gardez-la sous 1 000 caractères.",
    ),

    h("Ce que votre client voit"),
    p(
      "Une section ",
      ui("Vos documents finaux"),
      ", décrite comme le travail terminé de son comptable, prêt à télécharger. Chacun a un bouton ",
      ui("Télécharger"),
      ".",
    ),

    h("En reprendre un"),
    p(
      "Mauvais fichier téléversé ? Supprimez-le. Il disparaît aussi du portail de votre client.",
    ),
    note(
      "Vous pouvez les retenir jusqu'au paiement de la facture. Voyez ",
      link("/help/payments-and-invoices/the-invoice-lock", "le verrou de facture"),
      ".",
    ),
  ],
};

export const articles = {
  "connecting-stripe": connectingStripe,
  "creating-an-invoice": creatingAnInvoice,
  "how-your-client-pays": howYourClientPays,
  "the-invoice-lock": theInvoiceLock,
  "sending-final-documents": sendingFinalDocuments,
};

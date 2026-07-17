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

// NOTE DE TERMINOLOGIE : le produit dit « engagement » (le bouton « Nouvel
// engagement », les onglets, « Les engagements supprimés ») ET « mandat » à
// d'autres endroits (« Aucun mandat actif à cette étape », « Ce mandat est
// terminé »). Ces articles disent « engagement », qui est le mot du bouton,
// et le présentent comme un mandat pour que les deux se rejoignent dans la
// tête du lecteur.

export const meta: HelpCategoryMeta = {
  title: "Engagements",
  description:
    "L'unité de travail dans Vylan. Les modèles, la liste de documents, les étapes que traverse un mandat, et comment le terminer, l'archiver ou le supprimer.",
};

const templates: HelpArticle = {
  title: "Les modèles",
  summary:
    "Un modèle est une liste de documents réutilisable. Vylan en fournit neuf, et vous pouvez créer les vôtres pour ne jamais retaper la même liste.",
  keywords: [
    "modele",
    "modèle",
    "liste",
    "reutiliser",
    "réutiliser",
    "t1",
    "t2",
    "tenue de livres",
    "personnalise",
    "vide",
  ],
  body: [
    p(
      "L'essentiel de votre travail se répète. Chaque déclaration de particulier demande à peu près les mêmes feuillets. Un modèle capture cette liste une fois pour que vous ne la reconstruisiez pas client par client.",
    ),

    h("Ce qui vient avec Vylan"),
    p("Neuf modèles intégrés, prêts à servir :"),
    list(
      [ui("T1 — Particulier")],
      [ui("T2 — Société")],
      [ui("Tenue de livres — mensuel")],
      [ui("Travailleur autonome (T2125)")],
      [ui("Revenus de location (T776)")],
      [ui("TPS/TVQ — Déclaration")],
      [ui("Déclaration de fiducie (T3)")],
      [ui("Déclaration finale (succession)")],
      [ui("Accueil — nouveau client")],
    ),
    p(
      "Le sélecteur d'un nouvel engagement offre aussi ",
      ui("Vide"),
      ", qui vous laisse partir de rien et ajouter les documents à la main.",
    ),
    note(
      "Les modèles intégrés sont bilingues. Votre client voit chaque document nommé dans sa langue, quelle que soit celle dans laquelle vous travaillez.",
    ),

    h("Créer le vôtre"),
    steps(
      ["Allez dans ", ui("Modèles"), " dans la barre latérale."],
      ["Cliquez sur ", ui("+ Nouveau modèle"), "."],
      ["Ajoutez une ligne par document que vous voulez demander."],
      [
        "Donnez un type de document à chaque ligne. C'est la partie la plus importante, voir plus bas.",
      ],
      ["Enregistrez. Il apparaît dans le sélecteur aux côtés des modèles intégrés."],
    ),

    h("Pourquoi le type de document compte"),
    p(
      "Chaque ligne porte un type : T4, RL-1, T5, un avis de cotisation, un relevé bancaire, etc. C'est ce type que Vylan compare au téléversement. C'est la différence entre ",
      ui("Conforme"),
      " et ",
      ui("Attendu T4, détecté T4A"),
      ".",
    ),
    p(
      "Une ligne au type vague fonctionne quand même : votre client peut téléverser et vous pouvez approuver. Vous perdez seulement la vérification automatique sur cette ligne.",
    ),

    h("Modifier un modèle plus tard"),
    p(
      "Modifier un modèle touche les engagements créés à partir de ce moment. Ceux que vous avez déjà envoyés gardent la liste avec laquelle ils sont partis : un client n'est jamais surpris de voir un document apparaître sur sa page après coup.",
    ),
    note(
      "Ensuite : ",
      link("/help/engagements/the-document-checklist", "la liste de documents"),
      ".",
    ),
  ],
};

const theDocumentChecklist: HelpArticle = {
  title: "La liste de documents",
  summary:
    "Chaque engagement est une liste de documents que vous demandez. Voici comment la façonner, avant et après l'envoi.",
  keywords: [
    "liste",
    "documents",
    "demande",
    "ajouter",
    "retirer",
    "requis",
    "optionnel",
    "lignes",
  ],
  body: [
    p(
      "Ouvrez un engagement et le milieu de la page est une liste. Une ligne par document. Cette liste, c'est toute la conversation que vous avez avec votre client : ça vaut la peine de la soigner.",
    ),

    h("Façonner la liste"),
    p(
      "Ajoutez une ligne pour ce que le modèle a manqué. Retirez celles qui ne s'appliquent pas à ce client. Reformulez une ligne si votre client ne reconnaîtra pas le nom officiel, parce que c'est ce texte exact qu'il lit.",
    ),
    note(
      "Écrivez les lignes comme votre client pense, pas comme l'ARC écrit. ",
      ui("Votre relevé bancaire de décembre"),
      " obtient une réponse plus rapide que le numéro du formulaire.",
    ),

    h("Requis et optionnel"),
    p(
      "Les lignes marquées ",
      ui("Requis"),
      " sont celles que Vylan relance. Un engagement n'est pas terminé tant qu'une ligne requise est vide. Les lignes optionnelles sont demandées une fois, puis laissées tranquilles.",
    ),

    h("Changer la liste après l'envoi"),
    p(
      "Vous pouvez ajouter et retirer des lignes sur un engagement déjà envoyé. La page du client se met à jour, et Vylan intègre le changement à ses relances plutôt que d'envoyer une annonce séparée.",
    ),
    warn(
      "Retirer une ligne sur laquelle votre client a déjà téléversé retire la demande. Son fichier n'est pas supprimé en douce, mais la ligne cesse de faire partie du mandat. Si vous vouliez seulement l'accepter, approuvez-la plutôt.",
    ),

    h("Quand un client dit qu'une ligne ne s'applique pas"),
    p(
      "Les clients peuvent marquer une ligne ",
      ui("Non applicable"),
      " eux-mêmes. Elle cesse d'être un trou dans la liste et Vylan arrête de la relancer, et vous voyez chaque ligne marquée ainsi. Voyez ",
      link("/help/client-portal/how-clients-upload", "comment votre client téléverse ses documents"),
      ".",
    ),
  ],
};

const workflowStages: HelpArticle = {
  title: "Les étapes du mandat",
  summary:
    "Chaque engagement actif se trouve à l'une de six étapes, de la collecte des documents jusqu'à terminé. Vylan le fait avancer selon ce qui se produit réellement.",
  keywords: [
    "etape",
    "étape",
    "etapes",
    "étapes",
    "flux",
    "collecte",
    "verification",
    "vérification",
    "preparation",
    "préparation",
    "signature",
    "paiement",
    "termine",
    "terminé",
    "filtre",
  ],
  body: [
    p(
      "Un engagement n'est pas seulement fait ou pas fait. Il traverse un mandat. Vylan suit où chacun se trouve vraiment, pour qu'un coup d'œil à votre liste vous dise ce qui a besoin de vous aujourd'hui.",
    ),

    h("Les six étapes"),
    list(
      [ui("Collecte de documents"), " : en attente des documents du client."],
      [ui("En vérification"), " : les documents sont entrés et attendent vos yeux."],
      [ui("En préparation"), " : vous avez ce qu'il faut et le travail est en cours."],
      [ui("En attente de signature"), " : vous avez envoyé quelque chose à signer."],
      [ui("En attente de paiement"), " : le travail est fait et une facture est sortie."],
      [ui("Terminé"), " : fini."],
    ),

    h("Elles avancent toutes seules"),
    p(
      "Vous ne cochez pas ces cases. Vylan déduit l'étape de ce qui s'est vraiment produit : un client a téléversé, vous avez approuvé le dernier document, une signature est revenue, une facture a été payée. L'étape suit les faits.",
    ),
    p(
      "Elle saute aussi. Un mandat sans rien à signer ne s'arrête jamais à ",
      ui("En attente de signature"),
      ". Un mandat que vous ne facturez pas dans Vylan n'attend jamais à ",
      ui("En attente de paiement"),
      ".",
    ),

    h("La forcer"),
    p(
      "Parfois la réalité est en avance sur le dossier. Vous pouvez définir l'étape à la main depuis l'indicateur en haut d'un engagement, ou depuis le menu ",
      ui("..."),
      " de n'importe quelle ligne de votre liste. Les six étapes sont offertes, parce que c'est justement une correction manuelle.",
    ),
    note(
      "Forcer une étape, c'est un constat, pas un verrou. Si quelque chose de réel se produit ensuite, comme un paiement qui entre, Vylan fera avancer l'étape à nouveau.",
    ),

    h("Filtrer par étape"),
    p(
      "Votre liste d'engagements ",
      ui("Actifs"),
      " a un filtre par étape : vous pouvez sortir tout ce qui est ",
      ui("En vérification"),
      " et vider le lot. Le filtre vit dans l'adresse de la page : une vue filtrée survit à un aller-retour dans un mandat, et vous pouvez la mettre en signet.",
    ),
    note(
      "Les étapes disent où en est le travail. Savoir si un engagement est un brouillon, envoyé, terminé ou supprimé est une autre question. Voyez ",
      link("/help/engagements/statuses-and-stages", "statuts et étapes"),
      ".",
    ),
  ],
};

const statusesAndStages: HelpArticle = {
  title: "Statuts et étapes",
  summary:
    "Deux idées différentes qui se ressemblent. Le statut dit ce qui est arrivé à la vie d'un engagement. L'étape dit où le travail est rendu.",
  keywords: [
    "statut",
    "etape",
    "étape",
    "brouillon",
    "envoye",
    "envoyé",
    "en cours",
    "termine",
    "terminé",
    "difference",
    "différence",
  ],
  body: [
    p(
      "Vylan suit deux choses sur chaque engagement, et ça vaut trente secondes de les séparer, parce qu'elles répondent à des questions différentes.",
    ),

    h("Le statut : ce qui lui est arrivé"),
    list(
      [
        ui("Brouillon"),
        " : vous l'avez construit mais pas envoyé. Votre client n'en sait rien.",
      ],
      [ui("Envoyé"), " : votre client a son lien."],
      [ui("En cours"), " : les documents circulent."],
      [ui("Terminé"), " : vous l'avez fermé."],
    ),
    p(
      "Le statut, c'est vous. Envoyer, terminer et rouvrir sont vos décisions.",
    ),

    h("L'étape : où le travail est rendu"),
    p(
      "L'étape, c'est le parcours en six temps : collecte, vérification, préparation, attente de signature, attente de paiement, terminé. Vylan la déduit de ce qui s'est produit. Voyez ",
      link("/help/engagements/workflow-stages", "les étapes du mandat"),
      ".",
    ),

    h("Pourquoi les deux"),
    p(
      "Le statut répond à « ce mandat est-il ouvert ? ». L'étape répond à « ce mandat attend après quoi ? ». Un engagement peut être en cours pendant trois semaines, et la question utile n'est jamais s'il est ouvert. C'est s'il attend après votre client, après vous, ou après un chèque.",
    ),

    h("Où vous les voyez"),
    p(
      "Votre liste d'engagements affiche l'étape, parce que c'est celle sur laquelle on agit. Les onglets sur le côté, ",
      ui("Actifs"),
      ", ",
      ui("À réviser"),
      ", ",
      ui("Brouillons"),
      ", ",
      ui("Terminés"),
      ", ",
      ui("Archivés"),
      ", ",
      ui("Récemment supprimés"),
      ", découpent par statut.",
    ),
  ],
};

const completingAndArchiving: HelpArticle = {
  title: "Terminer et archiver",
  summary:
    "Comment fermer un engagement fini, ce que « terminer » arrête vraiment, et la différence entre archiver et supprimer.",
  keywords: [
    "terminer",
    "finir",
    "fermer",
    "archiver",
    "archive",
    "rouvrir",
    "fini",
    "arreter les rappels",
    "arrêter les rappels",
  ],
  body: [
    h("Terminer"),
    p(
      "Quand un mandat est fini, marquez-le terminé. Ça le ferme : Vylan cesse de relancer votre client, les suivis s'arrêtent, et la messagerie se ferme avec une note qui explique pourquoi à votre client. Tout l'historique reste lisible.",
    ),
    p(
      "Un engagement terminé passe dans votre onglet ",
      ui("Terminés"),
      " et quitte votre liste active.",
    ),
    note(
      "Changé d'idée, ou le client a envoyé une dernière chose ? Vous pouvez rouvrir un engagement terminé. Il redevient actif et reprend là où il en était.",
    ),

    h("Archiver"),
    p(
      "L'archivage sert aux engagements que vous voulez tasser sans les perdre. Les déclarations de l'an dernier, par exemple. Votre onglet ",
      ui("Archivés"),
      " les garde, et tout ce qu'ils contiennent reste exactement tel quel.",
    ),
    p(
      ui("Restaurer"),
      " en ramène un dans vos listes actives quand vous le voulez.",
    ),

    h("Archiver ou terminer ?"),
    p(
      "Terminez quand le travail est fini. Archivez quand vous voulez une liste propre. Les deux sont indépendants, et la plupart des cabinets terminent d'abord, puis archivent plus tard, à la fin d'une saison.",
    ),
    note(
      "Supprimer est autre chose, avec un vrai filet. Voyez ",
      link("/help/engagements/deleting-and-restoring", "supprimer et restaurer"),
      ".",
    ),
  ],
};

const deletingAndRestoring: HelpArticle = {
  title: "Supprimer et restaurer",
  summary:
    "La suppression est réversible pendant 30 jours, puis elle est définitive et emporte les fichiers. Voici exactement ce qui se passe, et quand.",
  keywords: [
    "supprimer",
    "suppression",
    "retirer",
    "restaurer",
    "recuperer",
    "récupérer",
    "annuler",
    "30 jours",
    "definitif",
    "définitif",
    "corbeille",
  ],
  body: [
    p(
      "Supprimer un engagement ne le détruit pas sur le coup. Il passe dans votre onglet ",
      ui("Récemment supprimés"),
      ", et vous avez un mois pour changer d'idée.",
    ),

    h("Ce qui se passe à la suppression"),
    steps(
      ["L'engagement quitte vos listes actives."],
      [
        "Il apparaît dans ",
        ui("Récemment supprimés"),
        ", avec une note du temps écoulé.",
      ],
      ["Vylan cesse de relancer votre client à son sujet."],
      ["Rien n'est encore détruit."],
    ),
    p(
      "Vylan le dit explicitement à l'écran : ",
      ui(
        "Vous pourrez le récupérer pendant 30 jours avant sa suppression définitive.",
      ),
    ),

    h("Restaurer"),
    p(
      "Ouvrez l'onglet ",
      ui("Récemment supprimés"),
      " et restaurez-le. Il revient avec ses documents, son historique et sa conversation intacts.",
    ),

    h("Après 30 jours"),
    warn(
      "À 30 jours, il est définitivement supprimé, et les fichiers téléversés partent avec lui. Cette étape ne peut être annulée ni par vous ni par nous. Si un engagement contient quoi que ce soit dont vous pourriez avoir besoin plus tard, téléchargez les fichiers d'abord, ou archivez-le au lieu de le supprimer.",
    ),

    h("Supprimer ou archiver ?"),
    p(
      "Supprimez une erreur. Archivez du vrai travail que vous avez fini. L'archivage garde tout pour toujours et c'est ce que vous voulez pour un mandat que vous avez réellement fait. Voyez ",
      link("/help/engagements/completing-and-archiving", "terminer et archiver"),
      ".",
    ),
  ],
};

export const articles = {
  templates,
  "the-document-checklist": theDocumentChecklist,
  "workflow-stages": workflowStages,
  "statuses-and-stages": statusesAndStages,
  "completing-and-archiving": completingAndArchiving,
  "deleting-and-restoring": deletingAndRestoring,
};

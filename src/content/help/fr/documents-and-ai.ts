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
  title: "Documents et vérifications IA",
  description:
    "Ce que Vylan fait de chaque fichier dès son arrivée, ce que les signalements veulent dire, et comment vous approuvez ou renvoyez un document.",
};

const howVylanChecksDocuments: HelpArticle = {
  title: "Comment Vylan vérifie chaque document",
  summary:
    "Chaque téléversement est lu automatiquement et comparé à ce que vous aviez demandé. Vylan vous dit ce qu'il croit avoir reçu et pourquoi. Vous gardez le dernier mot.",
  keywords: [
    "ia",
    "verification",
    "vérification",
    "verifier",
    "vérifier",
    "confiance",
    "flou",
    "illisible",
    "mauvais document",
    "mauvaise annee",
    "mauvaise année",
    "analyse",
    "limite",
    "plafond",
  ],
  body: [
    p(
      "Dès qu'un client téléverse un fichier, Vylan le lit et le compare au document que vous aviez demandé. Ça prend quelques secondes. Votre client voit ",
      ui("Vérification de votre document…"),
      " pendant ce temps.",
    ),

    warn(
      "La vérification est indicative. Le produit le dit lui-même à l'écran : ",
      ui("Suggestion automatique. Vous gardez le dernier mot."),
      " Vylan vous dit ce qu'il croit avoir sous les yeux. Il ne décide pas à votre place, et vous pouvez le contredire sur n'importe quel document.",
    ),

    h("Ce qu'il cherche"),
    list(
      ["Si le fichier est le type de document demandé, ou tout autre chose."],
      ["S'il est lisible, ou trop flou, trop sombre ou coupé pour servir."],
      ["S'il couvre la bonne année ou la bonne période."],
      ["Si le nom sur le document correspond au client pour qui vous recueillez."],
      ["S'il s'agit d'un doublon de ce qu'il a déjà envoyé pour cet engagement."],
    ),

    h("Ce que vous voyez sur le fichier"),
    p("Le résultat apparaît sur le document sous forme d'un court statut :"),
    list(
      [ui("Conforme"), " : le document lu correspond à ce que vous aviez demandé."],
      [ui("Confiance faible"), " : Vylan n'est pas sûr. Ça mérite votre coup d'œil."],
      [
        ui("Mauvais document"),
        " : le document lu est autre chose que ce que vous aviez demandé.",
      ],
      [ui("À revoir"), " : quelque chose cloche et Vylan vous le remet."],
      [
        ui("Rejeté automatiquement"),
        " : le fichier a été renvoyé au client automatiquement. Voir plus bas.",
      ],
      [
        ui("Non analysé"),
        " : la lecture automatique n'a pas eu lieu. Vous pouvez quand même réviser le fichier normalement.",
      ],
    ),
    p(
      "Quand il y a un écart, Vylan le dit en clair plutôt qu'avec une note sur cent. Des choses comme ",
      ui("Attendu T4, détecté T4A"),
      ", ou ",
      ui("2024 attendu, mais ce document indique 2023"),
      ", ou une mention que le nom sur le document ne correspond pas au client.",
    ),

    h("Pourquoi il pense ça"),
    p(
      "Ouvrez les détails et Vylan montre son raisonnement : ce qu'il a lu, l'émetteur, l'année ou la période, le formulaire, les montants trouvés, et ce que le document aurait pu être d'autre. Si vous n'êtes pas d'accord, un bouton dit exactement ce qu'il fait : ",
      ui("L'IA s'est trompée : approuver"),
      ".",
    ),
    p(
      "La lecture elle-même est faite par GPT-5.4 d'OpenAI, choisi pour une raison précise : il regarde le document de votre client en pleine résolution. Les modèles moins chers réduisent l'image avant de la voir, et c'est exactement comme ça qu'un gribouillis sur les chiffres de transit d'un chèque annulé passe pour « conforme ». Le détail qu'il doit attraper est petit, alors on ne le laisse pas plisser les yeux.",
    ),

    h("Renvoyer automatiquement les mauvais téléversements"),
    p(
      "Dans vos réglages se trouve un interrupteur nommé ",
      ui("Rejet automatique des téléversements invalides"),
      ". Activé, Vylan renvoie directement au client un téléversement illisible, incomplet ou qui n'est pas le document demandé, et lui demande de le reprendre. Désactivé, ces fichiers arrivent plutôt dans votre file de révision et rien ne repart vers le client tant que vous ne l'avez pas dit.",
    ),
    p(
      "Du côté du client, c'est doux. Il voit ",
      ui("Ce fichier ne semble pas valide. Veuillez réessayer"),
      " avec une invitation à reprendre une photo ou à envoyer le bon document. Quand un fichier passe, il voit plutôt ",
      ui("Bien reçu !"),
      ".",
    ),
    p(
      "Un second interrupteur, ",
      ui("Rejeter automatiquement les doublons"),
      ", vise le cas précis où un client envoie une copie exacte de ce qu'il a déjà téléversé pour cet engagement. Activé, le doublon est renvoyé automatiquement. Désactivé, il est signalé pour vous.",
    ),
    warn(
      "Ces deux interrupteurs sont ACTIVÉS à la création de votre cabinet. C'est voulu : les clients corrigent leurs erreurs le plus vite pendant qu'ils ont encore le document en main. Mais ça veut dire que Vylan renvoie déjà les mauvais téléversements à vos clients en votre nom, sans vous demander d'abord. Si vous préférez tout voir avant votre client, désactivez-les.",
    ),

    h("Relancer une page manquante"),
    p(
      "Un troisième interrupteur, ",
      ui("Demander automatiquement les pages manquantes"),
      ", traite le cas précis et très fréquent du client qui photographie trois pages d'un document qui en compte quatre. Activé, Vylan lui demande lui-même la page manquante. Désactivé, c'est signalé pour votre révision.",
    ),
    p(
      "Contrairement aux deux autres, celui-ci est désactivé au départ. Activez-le si vous le voulez.",
    ),
    note(
      "Celui-là a une limite sensée, et elle vaut la peine d'être connue : si Vylan n'est pas sûr de quelle page manque, ça vous revient toujours, jamais au client. Il ne devinera pas devant votre client.",
    ),

    h("Les feuillets du Québec"),
    p(
      ui("Inclure les formulaires fiscaux du Québec"),
      " est activé par défaut, et la plupart des cabinets devraient le laisser tranquille. Désactivez-le seulement si votre cabinet travaille entièrement hors du Québec : les feuillets propres au Québec, le RL-1, le RL-3 et compagnie, disparaissent alors de toutes les listes de clients.",
    ),
    p(
      "Laissé activé, c'est plus fin qu'il n'y paraît. Ces feuillets tombent quand même automatiquement pour tout client dont la province est réglée hors du Québec : un cabinet qui sert les deux côtés d'une frontière n'a pas à y penser.",
    ),

    h("Il y a une limite mensuelle"),
    p(
      "Les vérifications IA sont plafonnées chaque mois. Votre page de réglages indique où vous en êtes et si les vérifications sont ",
      ui("Actif"),
      " ou ",
      ui("En pause"),
      ", avec le nombre utilisé et la date de réinitialisation.",
    ),
    p(
      "Si vous atteignez la limite, les vérifications se mettent en pause jusqu'à la réinitialisation. Rien d'autre ne casse : vos clients téléversent exactement comme avant, et vous révisez les documents à la main entre-temps. Les cabinets à l'essai ont un nombre de vérifications gratuites plutôt qu'une allocation mensuelle.",
    ),
    note(
      "Ensuite : ",
      link(
        "/help/documents-and-ai/approving-and-rejecting",
        "approuver et refuser des documents",
      ),
      ".",
    ),
  ],
};

const approvingAndRejecting: HelpArticle = {
  title: "Approuver et refuser des documents",
  summary:
    "Comment accepter un document, comment en renvoyer un avec une raison que votre client comprendra vraiment, et ce que votre client voit quand vous le faites.",
  keywords: [
    "approuver",
    "refuser",
    "renvoyer",
    "raison",
    "reprendre",
    "resoumettre",
    "revision",
    "révision",
    "annuler",
    "file",
  ],
  body: [
    p(
      "Chaque document envoyé par un client attend une seule décision de votre part : est-ce bien ce que vous aviez demandé, oui ou non. La lecture de Vylan est une suggestion. Ceci est la vraie décision.",
    ),

    h("Approuver"),
    p(
      "Ouvrez l'engagement, regardez le document, et cliquez sur ",
      ui("Approuver"),
      ". La ligne est réglée. La page de votre client passe à ",
      ui("Approuvé"),
      " et Vylan cesse de relancer celle-là.",
    ),
    p(
      "Si Vylan a signalé quelque chose qui vous convient malgré tout, approuvez-le. Le bouton s'appelle ",
      ui("L'IA s'est trompée : approuver"),
      " et l'utiliser est parfaitement normal.",
    ),

    h("Refuser"),
    steps(
      ["Cliquez sur ", ui("Refuser"), " sur le document."],
      ["Écrivez une courte raison."],
      ["Confirmez. Le client est averti immédiatement et la ligne se rouvre pour lui."],
    ),
    p(
      "Sa page affiche ",
      ui("Refusé : à reprendre"),
      " avec votre raison juste à côté : il sait quoi faire sans vous écrire pour demander.",
    ),

    h("Écrivez la raison pour le client, pas pour vous"),
    p(
      "Votre client lit ce texte mot pour mot. Les raisons les plus utiles sont précises et disent quoi faire ensuite. Vylan en propose quelques-unes prêtes à l'emploi, que vous pouvez choisir et modifier :",
    ),
    list(
      [ui("Mauvais document : j'ai demandé un autre slip.")],
      [ui("Mauvaise année : veuillez envoyer le plus récent.")],
      [ui("Difficile à lire : pouvez-vous le numériser à nouveau ?")],
      [ui("Pages manquantes : veuillez renvoyer le document complet.")],
    ),
    p(
      "Une bonne raison nomme le problème et la solution, comme l'exemple intégré : ",
      ui("C'est votre T4 de 2023. J'ai besoin de celui de 2024."),
    ),

    warn(
      "Le client voit votre raison mot pour mot. Vylan vous en avertit à l'écran, et ce n'est pas pour rien : gardez-en les noms et les autres renseignements sensibles à l'écart. Écrivez-la comme s'il la lisait, parce qu'il la lit.",
    ),

    h("Changer d'idée"),
    p(
      "Refusé par erreur ? Un bouton ",
      ui("Annuler"),
      " se trouve sur le refus.",
    ),

    h("Quand le client est averti"),
    p(
      "Un refus rejoint le client par les mêmes canaux que le reste, et le document affiche ",
      ui("Client averti"),
      " une fois que c'est fait : vous ne vous demandez jamais si le message est parti.",
    ),
    note(
      "Si le rejet automatique est activé, Vylan fait déjà ça pour les téléversements manifestement inutilisables sans vous attendre. Voyez ",
      link(
        "/help/documents-and-ai/how-vylan-checks-documents",
        "comment Vylan vérifie chaque document",
      ),
      ".",
    ),
  ],
};

export const articles = {
  "how-vylan-checks-documents": howVylanChecksDocuments,
  "approving-and-rejecting": approvingAndRejecting,
};

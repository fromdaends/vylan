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
  title: "Pour commencer",
  description:
    "Ce qu'est Vylan, comment il s'intègre à votre pratique, et comment envoyer une première demande à un client.",
};

const whatIsVylan: HelpArticle = {
  title: "Qu'est-ce que Vylan",
  summary:
    "Vylan recueille les documents de vos clients à votre place. Vous dites ce qu'il vous faut, Vylan le demande, fait les relances, vérifie chaque fichier reçu et vous dit quand tout est entré.",
  keywords: [
    "apercu",
    "aperçu",
    "qu'est-ce que vylan",
    "introduction",
    "comptabilite",
    "comptabilité",
    "tenue de livres",
    "collecte de documents",
    "canada",
    "quebec",
    "québec",
  ],
  body: [
    p(
      "Vylan est conçu pour les petits cabinets comptables canadiens. Il s'occupe de la partie du travail qui gruge vos semaines sans rien facturer : sortir la paperasse des mains des clients.",
    ),
    p(
      "Vous indiquez à Vylan les documents dont vous avez besoin. Vylan envoie au client un lien privé par courriel, fait les suivis tout seul quand il n'y a plus de nouvelles, vérifie chaque fichier à son arrivée et vous présente une seule liste de ce qui manque encore. Le travail terminé, vous pouvez lui retourner les documents finaux, facturer et être payé au même endroit.",
    ),

    h("Le cycle de base"),
    steps(
      [
        "Vous créez un ",
        ui("engagement"),
        " : un mandat pour un client, par exemple une déclaration de revenus des particuliers.",
      ],
      ["Vous choisissez un modèle, qui remplit la liste de documents pour vous."],
      ["Vous l'envoyez. Votre client reçoit un courriel avec un lien privé."],
      ["Votre client téléverse ses documents. Sans mot de passe, sans compte."],
      ["Vylan vérifie chaque téléversement et vous signale ce qui cloche."],
      [
        "Vous approuvez ce qui est bon, refusez ce qui ne l'est pas, et Vylan redemande au client.",
      ],
      [
        "Quand tout est entré, vous faites le vrai travail, vous le retournez et vous êtes payé.",
      ],
    ),

    h("À qui ça s'adresse"),
    p(
      "Aux petits cabinets comptables et de tenue de livres, au Québec comme ailleurs au Canada. Ça fonctionne pour un cabinet d'une seule personne comme pour un cabinet de quelques employés. Si vous avez des collègues, vous pouvez activer le mode équipe et vous répartir le travail.",
    ),

    h("En français et en anglais"),
    p(
      "Tout le produit est bilingue, y compris les courriels que vos clients reçoivent. Vous choisissez votre langue dans vos réglages, et chaque client est contacté dans la sienne. Les deux sont indépendantes : vous pouvez travailler en anglais pendant que votre client reçoit tout en français.",
    ),

    h("Où vos données sont hébergées"),
    p("Vos données sont hébergées au Canada."),
    note(
      "Envie d'essayer ? ",
      link("/how-it-works", "Voyez comment ça marche"),
      " pour la visite guidée, ou lisez ",
      link("/help/getting-started/your-first-engagement", "votre premier engagement"),
      " pour vous lancer.",
    ),
  ],
};

const yourFirstEngagement: HelpArticle = {
  title: "Votre premier engagement",
  summary:
    "Un engagement, c'est un mandat pour un client. Voici comment en créer un, choisir ce que vous demandez, et l'envoyer.",
  keywords: [
    "premier",
    "nouvel engagement",
    "creer",
    "créer",
    "envoyer",
    "modele",
    "modèle",
    "demarrer",
    "démarrer",
    "debut",
    "début",
  ],
  body: [
    p(
      "Un ",
      ui("engagement"),
      " est un mandat pour un client. Une déclaration de revenus 2024. Un mois de tenue de livres. Une déclaration TPS/TVQ. Chacun porte sa propre liste de documents, sa propre conversation avec le client et sa propre progression.",
    ),

    h("Le créer"),
    steps(
      [
        "Cliquez sur ",
        ui("Nouvel engagement"),
        ". Le bouton est sur votre page d'aperçu, et il y a aussi un raccourci clavier : appuyez sur ",
        ui("c"),
        " de n'importe où dans l'application.",
      ],
      ["Choisissez un modèle. C'est lui qui décide des documents que Vylan demandera."],
      ["Choisissez un client existant, ou créez-en un nouveau sur place."],
      ["Donnez un titre à l'engagement, pour le reconnaître dans une liste plus tard."],
    ),

    h("Choisir un modèle"),
    p("Un modèle est une liste réutilisable. Vylan en fournit déjà plusieurs :"),
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
      "Le sélecteur offre aussi une option ",
      ui("Vide"),
      " si vous préférez partir de zéro et ajouter les documents vous-même.",
    ),
    note(
      "Le modèle ne vous enferme pas. Une fois l'engagement créé, vous pouvez ajouter, retirer ou reformuler n'importe quel document de la liste avant l'envoi.",
    ),

    h("Vérifier la liste de documents"),
    p(
      "Chaque ligne de la liste correspond à un document que vous demandez. Chaque ligne porte un type de document, et c'est précisément ce qui permet à Vylan de vérifier le téléversement plus tard et de remarquer qu'un client a envoyé un feuillet de 2023 au lieu de celui de 2024. Ajustez la liste jusqu'à ce qu'elle corresponde à ce dont vous avez réellement besoin pour ce client.",
    ),

    h("L'envoyer"),
    p(
      "Cliquez sur envoyer. Votre client reçoit un courriel avec un lien privé vers sa propre page. Il ne crée pas de compte et ne choisit pas de mot de passe. À partir de là, Vylan prend le relais des relances : il fait les suivis selon son propre calendrier jusqu'à ce que les documents soient entrés.",
    ),
    note(
      "Ensuite : ",
      link(
        "/help/client-portal/how-your-client-gets-their-link",
        "comment votre client reçoit son lien",
      ),
      ".",
    ),
  ],
};

const demoModeAndGoingLive: HelpArticle = {
  title: "Le mode démo et le passage en mode actif",
  summary:
    "Un nouveau cabinet démarre en mode démo, où rien n'est envoyé par courriel à vos clients. Passer en mode actif tient à un bouton, et c'est celui qui met les relances en marche.",
  keywords: [
    "demo",
    "démo",
    "mode demo",
    "actif",
    "passer en mode actif",
    "en pause",
    "courriels ne partent pas",
    "rappels ne partent pas",
    "essai",
    "test",
  ],
  body: [
    p(
      "Vylan vous démarre en mode démo, exprès. Vous pouvez bâtir des engagements, vous inviter vous-même, tout cliquer et vous tromper, sans qu'un seul courriel atteigne un vrai client.",
    ),

    h("Ce que le mode démo arrête"),
    p("Vylan vous le dit clairement en haut de vos réglages :"),
    p(ui("Vous êtes en mode démo. Les courriels aux clients sont en pause.")),
    p(
      "C'est la partie importante, et elle prend les gens par surprise. Tant que votre cabinet est en démo, les rappels automatiques ne partent pas. Tout le reste a l'air de fonctionner, parce que c'est le cas : le calendrier est bâti, l'engagement est actif, l'étape avance. Ce sont seulement les courriels qui ne sortent pas.",
    ),
    warn(
      "Si vous avez envoyé un vrai engagement à un vrai client et qu'il n'a rien reçu, c'est la première chose à vérifier. C'est de loin la raison la plus fréquente pour laquelle Vylan a l'air brisé alors qu'il ne l'est pas.",
    ),

    h("Passer en mode actif"),
    steps(
      ["Ouvrez vos réglages."],
      ["Trouvez la bannière de démo en haut."],
      ["Cliquez sur ", ui("Passer en mode actif"), "."],
    ),
    p(
      "La bannière disparaît, les vrais courriels commencent à partir, et ce qui était en pause reprend au prochain passage, dans un quart d'heure environ. Vylan vous dit ce qu'il a relancé : il nomme le nombre d'engagements dont les rappels ont repris.",
    ),
    note(
      "Seul l'administrateur du cabinet peut passer en mode actif. Si vous êtes membre et que la bannière ne bouge pas, c'est pour ça. Voyez ",
      link("/help/team/owners-and-members", "administrateurs et membres"),
      ".",
    ),

    h("Une porte à sens unique, dans le bon sens"),
    p(
      "Le mode actif est l'état normal. Il n'y a aucune raison de revenir en arrière, et Vylan vous le dira si vous essayez, parce que votre cabinet est déjà actif.",
    ),
    note(
      "Ensuite : ",
      link("/help/getting-started/your-first-engagement", "votre premier engagement"),
      ".",
    ),
  ],
};

export const articles = {
  "what-is-vylan": whatIsVylan,
  "your-first-engagement": yourFirstEngagement,
  "demo-mode-and-going-live": demoModeAndGoingLive,
};

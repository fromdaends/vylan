import {
  type HelpArticle,
  type HelpCategoryMeta,
  p,
  h,
  ui,
  link,
  note,
  warn,
} from "../types";

// CONTENU PROVISOIRE — règle du fondateur, ne pas remplir.
//
// Les deux NOMS de cofondateurs sont réels et confirmés par le fondateur
// (2026-07-16) : Zachary Thresh et Tyler Jette. Tout le reste de cette page —
// l'histoire de l'entreprise, les biographies, les rôles, la raison d'avoir
// démarré — est PROVISOIRE et marqué comme tel SUR LA PAGE, sous les yeux du
// lecteur, pas dans un commentaire de code.
//
// Ne PAS inventer d'histoire de fondation, de parcours, de titre, de ville ou
// d'ancien employeur. Ne pas « améliorer » les marqueurs en les rendant
// plausibles : une fausse biographie plausible est pire qu'un blanc évident,
// parce que personne ne la rattrape. Le fondateur fournit le vrai texte.

export const meta: HelpCategoryMeta = {
  title: "À propos de Vylan",
  description: "Qui bâtit Vylan, et pourquoi.",
};

const PLACEHOLDER = "TEXTE PROVISOIRE";

const ourStory: HelpArticle = {
  title: "Notre histoire",
  summary:
    "Pourquoi Vylan existe, dans les mots des fondateurs. Cette page est encore à écrire.",
  keywords: [
    "a propos",
    "à propos",
    "histoire",
    "entreprise",
    "pourquoi",
    "mission",
    "fondation",
  ],
  body: [
    warn(
      ui(PLACEHOLDER),
      " — cette page attend le vrai texte des fondateurs. Tout ce qui suit est un espace réservé et ne doit pas être lu comme un fait.",
    ),

    h("Pourquoi Vylan existe"),
    p(
      ui(PLACEHOLDER),
      " : l'histoire de la naissance de Vylan, racontée par ceux qui l'ont lancée. Pas encore écrite.",
    ),

    h("Ce qu'on essaie de faire"),
    p(
      ui(PLACEHOLDER),
      " : à quoi sert l'entreprise, au-delà de la liste de fonctionnalités. Pas encore écrit.",
    ),

    note(
      "En attendant, ",
      link("/how-it-works", "comment ça marche"),
      " vous montre le produit lui-même, et ",
      link("/contact", "nous joindre"),
      " rejoint une vraie personne.",
    ),
  ],
};

const theFounders: HelpArticle = {
  title: "Les fondateurs",
  summary:
    "Vylan est bâti par Zachary Thresh et Tyler Jette. Leurs biographies complètes restent à écrire.",
  keywords: [
    "fondateurs",
    "equipe",
    "équipe",
    "qui",
    "zachary",
    "thresh",
    "tyler",
    "jette",
    "a propos",
  ],
  body: [
    warn(
      ui(PLACEHOLDER),
      " — les noms ci-dessous sont réels. Les biographies ne sont pas encore écrites, et rien n'a été inventé pour combler le vide.",
    ),

    h("Zachary Thresh"),
    p("Cofondateur."),
    p(ui(PLACEHOLDER), " : biographie à venir."),

    h("Tyler Jette"),
    p("Cofondateur."),
    p(ui(PLACEHOLDER), " : biographie à venir."),

    h("Nous parler"),
    p(
      "Vylan est petit, ce qui veut dire que la personne qui répond à hello@vylan.app est une des personnes qui le bâtissent. Si quelque chose ici est faux, ou manquant, ou si vous voulez simplement débattre de la façon dont la collecte de documents devrait fonctionner, cette adresse nous rejoint.",
    ),
    note(
      "Envie d'en parler pour vrai ? ",
      link("/contact", "Nous joindre"),
      " a les coordonnées, ou réservez une démo depuis la ",
      link("/", "page d'accueil"),
      ".",
    ),
  ],
};

export const articles = {
  "our-story": ourStory,
  "the-founders": theFounders,
};

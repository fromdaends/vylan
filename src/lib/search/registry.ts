import {
  LayoutDashboard,
  Users,
  Briefcase,
  BookOpen,
  Plug,
  ListChecks,
  PencilLine,
  ClipboardList,
  Archive,
  XCircle,
  Trash2,
  FileText,
  Bell,
  UserCircle,
  Building2,
  UserCog,
  ShieldCheck,
  Palette,
  SlidersHorizontal,
  Languages,
  Clock,
  FileCheck2,
  Settings as SettingsIcon,
  CreditCard,
  ScrollText,
  FilePlus2,
  UserPlus,
  Upload,
  Download,
  LogOut,
  Moon,
  Sun,
  Monitor,
  type LucideIcon,
} from "lucide-react";

// The static side of global search: a hand-curated catalog of every place you
// can go and every "small thing" you can do in the app. The command palette
// merges these matches with the live /api/search records (clients, engagements,
// templates). Anything that should be findable but isn't a DB record lives here.
//
// Each entry carries a hidden, intentionally BILINGUAL `keywords` blob (EN + FR
// + common abbreviations). It is never shown — it only feeds the matcher — so a
// user typing "2fa", "deux facteurs", "dark mode", or "fuseau horaire" all land
// on the right entry regardless of the UI language.

export type SearchActionId =
  | "logout"
  | "theme-light"
  | "theme-dark"
  | "theme-system";

export type SearchGroup = "go" | "action";

export type SearchEntry = {
  id: string;
  /** Localized, shown to the user. */
  label: string;
  /** Hidden bilingual synonym blob; matched against, never displayed. */
  keywords: string;
  group: SearchGroup;
  icon: LucideIcon;
  /** Tailwind text-icon-* class (or any text-* color). */
  color?: string;
  /** Navigation target. Mutually exclusive with `action`. */
  href?: string;
  /** Non-navigation action, handled by the palette. */
  action?: SearchActionId;
  /** Hidden for non-owners (billing, audit log, firm export/delete). */
  ownerOnly?: boolean;
  /** Hidden until the firm has connected QuickBooks (any client). */
  requiresQuickbooks?: boolean;
  /** Shown in the idle "Jump to" list (before the user types). */
  primary?: boolean;
};

// next-intl `useTranslations(ns)` instances, one per namespace we borrow labels
// from. Kept as a typed bag so the registry stays decoupled from the component.
export type RegistryTranslators = {
  app: (key: string) => string;
  eng: (key: string) => string;
  set: (key: string) => string;
  profile: (key: string) => string;
  auth: (key: string) => string;
  cmd: (key: string) => string;
};

export function buildSearchRegistry(
  t: RegistryTranslators,
  opts: { isOwner: boolean; quickbooksConnected?: boolean },
): SearchEntry[] {
  const entries: SearchEntry[] = [
    // ── Destinations ("Go to") ───────────────────────────────────────────
    {
      id: "dashboard",
      label: t.app("nav_dashboard"),
      group: "go",
      icon: LayoutDashboard,
      color: "text-icon-blue",
      href: "/dashboard",
      primary: true,
      keywords: "home overview dashboard start accueil tableau de bord apercu",
    },
    {
      id: "clients",
      label: t.app("nav_clients"),
      group: "go",
      icon: Users,
      color: "text-icon-emerald",
      href: "/clients",
      primary: true,
      keywords: "clients customers contacts clientele client",
    },
    {
      id: "engagements",
      label: t.app("nav_engagements"),
      group: "go",
      icon: Briefcase,
      color: "text-icon-blue",
      href: "/engagements",
      primary: true,
      keywords:
        "engagements active work files dossiers mandats mandat jobs in progress",
    },
    {
      id: "eng-ready",
      label: t.eng("view_ready_title"),
      group: "go",
      icon: ListChecks,
      color: "text-icon-indigo",
      href: "/engagements/ready",
      keywords: "ready to review awaiting review queue prets a reviser a reviser",
    },
    {
      // The Integrations HUB — always reachable. Sage 50 (a file export) needs no
      // connection, so this destination exists for every firm, connected or not.
      // Mirrors the sidebar's always-visible Integrations section.
      id: "integrations",
      label: t.app("nav_integrations"),
      group: "go",
      icon: Plug,
      color: "text-icon-cyan",
      href: "/integrations",
      keywords:
        "integrations integration connect apps sage sage 50 export file quickbooks qbo intuit comptabilite exportation",
    },
    {
      // The shared drafts queue (QuickBooks + Xero) — the "Bookkeeping" tab.
      // Always listed; the page guides an owner to connect from a client's page
      // when nothing's linked yet.
      id: "bookkeeping-drafts",
      label: t.app("nav_bookkeeping"),
      group: "go",
      icon: BookOpen,
      color: "text-icon-cyan",
      href: "/quickbooks/drafts",
      keywords:
        "bookkeeping drafts transactions receipts invoices approve dismiss quickbooks xero brouillons ecritures approuver comptabilite",
    },
    {
      // Direct QuickBooks shortcut — its connect/manage page (mirrors the
      // always-visible sidebar sub-item + hub card). "QuickBooks" is a brand
      // name, so it isn't localized.
      id: "integrations-quickbooks",
      label: "QuickBooks",
      group: "go",
      icon: Plug,
      color: "text-icon-cyan",
      href: "/integrations/quickbooks",
      keywords: "quickbooks connect integration qbo intuit comptabilite",
    },
    {
      // Direct Xero shortcut — always listed (its landing page guides
      // connecting per client). "Xero" is a brand name, not localized.
      id: "integrations-xero",
      label: "Xero",
      group: "go",
      icon: Plug,
      color: "text-icon-cyan",
      href: "/integrations/xero",
      keywords:
        "xero bookkeeping accounting connect integration comptabilite",
    },
    {
      id: "eng-drafts",
      label: t.eng("view_drafts_title"),
      group: "go",
      icon: PencilLine,
      color: "text-icon-amber",
      href: "/engagements/drafts",
      keywords: "drafts draft unsent not sent brouillons brouillon",
    },
    {
      id: "eng-completed",
      label: t.eng("view_completed_title"),
      group: "go",
      icon: ClipboardList,
      color: "text-icon-emerald",
      href: "/engagements/completed",
      keywords: "completed complete done finished termines completes",
    },
    {
      id: "eng-archived",
      label: t.eng("view_archived_title"),
      group: "go",
      icon: Archive,
      color: "text-icon-cyan",
      href: "/engagements/archived",
      keywords: "archived archive archives",
    },
    {
      id: "eng-cancelled",
      label: t.eng("view_cancelled_title"),
      group: "go",
      icon: XCircle,
      color: "text-icon-rose",
      href: "/engagements/cancelled",
      keywords: "cancelled canceled annules annule",
    },
    {
      id: "eng-deleted",
      label: t.eng("view_deleted_title"),
      group: "go",
      icon: Trash2,
      color: "text-icon-rose",
      href: "/engagements/deleted",
      keywords:
        "recently deleted trash recover restore corbeille supprimes recemment supprimes",
    },
    {
      id: "templates",
      label: t.app("nav_templates"),
      group: "go",
      icon: FileText,
      color: "text-icon-amber",
      href: "/templates",
      primary: true,
      keywords:
        "templates checklists modeles modele t1 t2 bookkeeping tenue de livres",
    },
    {
      id: "notifications",
      label: t.cmd("cat_whats_new"),
      group: "go",
      icon: Bell,
      color: "text-icon-indigo",
      href: "/notifications",
      keywords:
        "notifications whats new activity alerts updates nouveautes quoi de neuf avis",
    },
    {
      id: "profile",
      label: t.profile("menu_profile"),
      group: "go",
      icon: UserCircle,
      color: "text-icon-blue",
      href: "/profile",
      keywords:
        "profile your account photo avatar display name profil nom photo de profil",
    },
    {
      id: "firm-settings",
      label: t.set("section_firm_settings"),
      group: "go",
      icon: Building2,
      color: "text-icon-emerald",
      href: "/settings?tab=account",
      keywords:
        "firm settings logo brand color firm name client language branding cabinet logo couleur de marque nom du cabinet langue des clients",
    },
    {
      id: "account",
      label: t.set("nav_account"),
      group: "go",
      icon: UserCog,
      color: "text-icon-blue",
      href: "/settings?tab=account",
      keywords:
        "account email password sign in login credentials change email change password compte courriel mot de passe connexion identifiants",
    },
    {
      id: "two-factor",
      label: t.profile("mfa_title"),
      group: "go",
      icon: ShieldCheck,
      color: "text-icon-emerald",
      href: "/settings?tab=security",
      keywords:
        "two factor 2fa mfa authenticator totp security authentification deux facteurs double authentification securite",
    },
    {
      id: "appearance",
      label: t.set("nav_appearance"),
      group: "go",
      icon: Palette,
      color: "text-icon-indigo",
      href: "/settings?tab=appearance",
      keywords:
        "appearance theme dark light mode colors apparence theme sombre clair mode couleurs",
    },
    {
      id: "general",
      label: t.set("nav_general"),
      group: "go",
      icon: SlidersHorizontal,
      color: "text-icon-cyan",
      href: "/settings?tab=general",
      keywords: "general preferences parametres generaux preferences",
    },
    {
      id: "language",
      label: t.set("section_language"),
      group: "go",
      icon: Languages,
      color: "text-icon-blue",
      href: "/settings?tab=general",
      keywords:
        "site language french english interface language langue francais anglais traduction",
    },
    {
      id: "timezone",
      label: t.set("section_timezone"),
      group: "go",
      icon: Clock,
      color: "text-icon-amber",
      href: "/settings?tab=general",
      keywords: "timezone time zone clock fuseau horaire heure",
    },
    {
      id: "documents",
      label: t.set("nav_documents"),
      group: "go",
      icon: FileCheck2,
      color: "text-icon-emerald",
      href: "/settings?tab=documents",
      keywords:
        "documents auto reject invalid unreadable uploads quality documents qualite rejet automatique televersements illisibles",
    },
    {
      id: "settings",
      label: t.app("nav_settings"),
      group: "go",
      icon: SettingsIcon,
      color: "text-icon-cyan",
      href: "/settings",
      primary: true,
      keywords: "settings preferences parametres reglages configuration",
    },
    {
      // Internal id stays "billing" (the subscription card); the user-facing
      // label + destination moved to the new Payments section in settings.
      id: "billing",
      label: t.set("nav_payments"),
      group: "go",
      icon: CreditCard,
      color: "text-icon-amber",
      href: "/settings?tab=payments",
      ownerOnly: true,
      keywords:
        "payments billing subscription plan invoice payment upgrade paiements facturation abonnement forfait paiement facture",
    },
    {
      id: "audit",
      label: t.set("audit_link_label"),
      group: "go",
      icon: ScrollText,
      color: "text-icon-indigo",
      href: "/settings/audit",
      ownerOnly: true,
      keywords:
        "audit log security history activity trail journal verification historique securite",
    },

    // ── Actions ──────────────────────────────────────────────────────────
    {
      id: "new-engagement",
      label: t.cmd("cat_new_engagement"),
      group: "action",
      icon: FilePlus2,
      color: "text-icon-blue",
      href: "/engagements/new",
      keywords:
        "new engagement create add start nouvel engagement nouveau mandat creer ajouter commencer",
    },
    {
      id: "add-client",
      label: t.cmd("cat_add_client"),
      group: "action",
      icon: UserPlus,
      color: "text-icon-emerald",
      href: "/clients",
      keywords: "add client new client create ajouter un client nouveau client",
    },
    {
      id: "import-clients",
      label: t.cmd("cat_import_clients"),
      group: "action",
      icon: Upload,
      color: "text-icon-cyan",
      href: "/clients/import",
      keywords:
        "import clients csv upload spreadsheet bulk importer csv tableur en masse televerser",
    },
    {
      id: "new-template",
      label: t.cmd("cat_new_template"),
      group: "action",
      icon: FilePlus2,
      color: "text-icon-amber",
      href: "/templates",
      keywords: "new template create checklist nouveau modele creer liste",
    },
    {
      id: "export",
      label: t.set("data_export_label"),
      group: "action",
      icon: Download,
      color: "text-icon-cyan",
      href: "/settings?tab=security",
      ownerOnly: true,
      keywords:
        "export firm data download backup zip exporter donnees telecharger sauvegarde",
    },
    {
      id: "delete-firm",
      label: t.set("data_delete_label"),
      group: "action",
      icon: Trash2,
      color: "text-icon-rose",
      href: "/settings?tab=security",
      ownerOnly: true,
      keywords:
        "delete firm close account remove erase supprimer cabinet fermer compte effacer",
    },
    {
      id: "logout",
      label: t.auth("logout"),
      group: "action",
      icon: LogOut,
      color: "text-muted-foreground",
      action: "logout",
      keywords: "log out logout sign out leave exit deconnexion se deconnecter quitter",
    },
    {
      id: "theme-dark",
      label: t.set("theme_dark"),
      group: "action",
      icon: Moon,
      color: "text-icon-indigo",
      action: "theme-dark",
      keywords: "dark mode night theme sombre nuit mode fonce noir",
    },
    {
      id: "theme-light",
      label: t.set("theme_light"),
      group: "action",
      icon: Sun,
      color: "text-icon-amber",
      action: "theme-light",
      keywords: "light mode day theme clair jour mode blanc",
    },
    {
      id: "theme-system",
      label: t.set("theme_system"),
      group: "action",
      icon: Monitor,
      color: "text-muted-foreground",
      action: "theme-system",
      keywords: "system theme auto os default systeme automatique appareil",
    },
  ];

  return entries.filter(
    (e) =>
      (opts.isOwner || !e.ownerOnly) &&
      (!e.requiresQuickbooks || opts.quickbooksConnected === true),
  );
}

// ── Matching ────────────────────────────────────────────────────────────────

// Fold case + strip accents so "securite" matches "Sécurité" and "francais"
// matches "français" no matter how the user types it.
export function normalizeSearch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// AND-match: every query token must appear in (label + keywords). Ranked so
// label-prefix hits surface first, then label word-starts, then label
// substrings, then keyword-only matches. Stable within a tier.
export function matchEntries(
  entries: SearchEntry[],
  query: string,
): SearchEntry[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const tokens = q.split(" ");

  const scored: { entry: SearchEntry; score: number; i: number }[] = [];
  entries.forEach((entry, i) => {
    const label = normalizeSearch(entry.label);
    const hay = label + " " + normalizeSearch(entry.keywords);
    if (!tokens.every((tok) => hay.includes(tok))) return;

    let score: number;
    if (label.startsWith(q)) score = 100;
    else if (label.split(" ").some((w) => w.startsWith(tokens[0]))) score = 80;
    else if (label.includes(q)) score = 60;
    else score = 30; // matched only via the hidden keyword synonyms
    scored.push({ entry, score, i });
  });

  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map((s) => s.entry);
}

// Chrome shared by every help page: the brand menu, the blue hero with the
// search bubble, the white sheet, and the footer.
//
// Server component. The only client island is HelpSearch — everything else is
// static text, and a help center is the last place that should ship
// JavaScript to render a paragraph.
//
// LAYOUT NOTE: the page root is `vy-root vy-help`. Taking .vy-root wholesale
// gives us the brand tokens, Schibsted, and the blue page, which is what lets
// VylanMenu and VylanFooter (both hard-coded white-on-blue) work here with no
// overrides at all. The white body is a sheet on top of that blue. See the
// header of vylan-help.css.

import { getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import { brand } from "@/lib/brand";
import { schibsted } from "@/components/vylan-landing/fonts";
import { VylanMenu } from "@/components/vylan-landing/vylan-menu";
import { VylanFooter } from "@/components/vylan-landing/vylan-footer";
import { HelpSearch } from "./help-search";
import { buildSearchIndex } from "@/content/help/registry";
import "@/styles/vylan-landing.css";
import "@/styles/vylan-help.css";

// The landing page's lead form, which help pages deliberately do not render.
const LEAD_FORM_ANCHOR = "vy-get-access";

export async function HelpShell({
  locale,
  title,
  sub,
  compact = false,
  children,
}: {
  locale: AppLocale;
  title: string;
  sub?: string;
  // Index page gets the full-height hero. Category and article pages get a
  // shorter one so the content they came for isn't below the fold.
  compact?: boolean;
  children: React.ReactNode;
}) {
  const t = await getTranslations("HelpCenter");
  const tv = await getTranslations("Vylan");

  // Resolved, locale-prefixed URLs. Built here on the server because the menu
  // and footer are client components and shouldn't be re-deriving routing.
  const bookDemoHref = `${getPathname({ locale, href: "/" })}#${LEAD_FORM_ANCHOR}`;

  const menu = {
    brand: tv("brand_word"),
    logoAlt: tv("logo_alt"),
    menuLabel: tv("menu_label"),
    closeLabel: tv("menu_close"),
    defTerm: tv("menu_def_term"),
    defAbbr: tv("menu_def_abbr"),
    defText: tv("menu_def_text"),
    navHome: tv("nav_home"),
    navHowItWorks: tv("nav_how_it_works"),
    navBookDemo: tv("nav_book_demo"),
    navLogin: tv("nav_login"),
    navContact: tv("nav_contact"),
    follow: tv("follow"),
  };

  const footer = {
    brand: tv("brand_word"),
    howItWorks: tv("footer_how_it_works"),
    bookDemo: tv("footer_book_demo"),
    contact: tv("footer_contact"),
    login: tv("footer_login"),
    copyright: tv("footer_copyright"),
    location: tv("contact_location_value"),
  };

  const searchStrings = {
    placeholder: t("search_placeholder"),
    label: t("search_label"),
    clear: t("search_clear"),
    noResults: t("search_no_results"),
    noResultsHint: t("search_no_results_hint"),
    contactCta: t("search_no_results_cta"),
  };

  return (
    <div className={`vy-root vy-help ${schibsted.variable}`}>
      {/* No helpHref/navHelp here: we're already on the help center. The
          landing, how-it-works, and contact pages pass those in. */}
      <VylanMenu s={menu} bookDemoHref={bookDemoHref} />

      <header className={`vyh-hero${compact ? " vyh-hero-compact" : ""}`}>
        <h1 className="vyh-title">{title}</h1>
        {sub ? <p className="vyh-sub">{sub}</p> : null}
        <HelpSearch
          index={buildSearchIndex(locale)}
          s={searchStrings}
          contactHref={`mailto:${brand.supportEmail}`}
        />
      </header>

      <main className="vyh-sheet">{children}</main>

      <VylanFooter s={footer} bookDemoHref={bookDemoHref} />
    </div>
  );
}

// The "still stuck?" block that closes the category and article pages. Lives
// here rather than in each page so the support address and the contact route
// are stated once.
export async function StillStuck({ locale }: { locale: AppLocale }) {
  const t = await getTranslations("HelpCenter");
  return (
    <div className="vyh-stuck">
      <div className="vyh-stuck-title">{t("stuck_title")}</div>
      <p className="vyh-stuck-body">{t("stuck_body")}</p>
      <div className="vyh-stuck-actions">
        <a className="vyh-btn" href={`mailto:${brand.supportEmail}`}>
          {t("stuck_email")}
        </a>
        <a
          className="vyh-btn vyh-btn-ghost"
          href={getPathname({ locale, href: "/contact" })}
        >
          {t("stuck_contact")}
        </a>
      </div>
    </div>
  );
}

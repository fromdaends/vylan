// The site-wide black footer (Karbon-style), on every public page: landing,
// how-it-works, contact, the whole help center, privacy and terms.
//
// SELF-TRANSLATING on purpose. The old footer took a bag of strings from
// every caller, which meant four pages each rebuilding the same object and a
// fifth (privacy/terms) using a different footer entirely because nobody
// wanted to wire the strings. This one reads its own locale and translations,
// so a page renders `<VylanFooter />` and is done — which is the only reason
// "the same footer on every page" stays true over time.
//
// CONTENT RULE (founder, 2026-07-17): only what actually exists. No social
// links (the menu's icons are decorative placeholders with no URLs), no
// pricing (retired), no manifesto (retired — redirects to how-it-works), no
// About links yet (live but visibly placeholder until the founders' bios
// land). The founder adds sections here as they become real.

import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { getCategory } from "@/content/help/registry";
import type { AppLocale } from "@/i18n/routing";
import { FooterLangSwitch, FooterDemoLink } from "./vylan-footer-client";
import "@/styles/vylan-footer.css";

// The two business lines. E.164 in the tel: href, human-friendly in the label.
// Also rendered (larger) on the /contact page, which imports this constant.
export const VYLAN_PHONES = [
  { tel: "+14508306455", label: "450-830-6455" },
  { tel: "+14383415160", label: "438-341-5160" },
] as const;

// The help categories the footer links directly. A curated slice, not all 15
// — a footer is a map, not an index. Titles come from the help registry so a
// renamed category can never leave the footer stale.
const FOOTER_HELP_CATEGORIES = [
  "getting-started",
  "client-portal",
  "e-signatures",
  "payments-and-invoices",
  "security",
] as const;

export async function VylanFooter({
  onHelpSite = false,
}: {
  // The original help-center spec (founder) opens /help in a NEW TAB from the
  // landing page and the app. On the help site itself that would be absurd —
  // you're already there — so the HelpShell passes this to make the help
  // links ordinary same-tab navigation.
  onHelpSite?: boolean;
}) {
  const locale = (await getLocale()) as AppLocale;
  const t = await getTranslations("Vylan");
  const tf = await getTranslations("Footer");

  const helpTarget = onHelpSite
    ? {}
    : { target: "_blank", rel: "noopener noreferrer" };

  const helpCols = FOOTER_HELP_CATEGORIES.map((slug) => ({
    slug,
    title: getCategory(locale, slug).meta.title,
  }));

  return (
    <footer className="vyf">
      <div className="vyf-inner">
        <div className="vyf-top">
          <div className="vyf-brand">
            <div className="vyf-wordmark">{t("brand_word")}</div>
            <div className="vyf-basedin">{tf("based_in")}</div>
            <FooterLangSwitch label={t("footer_language")} />
          </div>

          <nav className="vyf-col" aria-label={t("footer_col_product")}>
            <h3 className="vyf-col-title">{t("footer_col_product")}</h3>
            <ul>
              <li>
                <Link href="/how-it-works">{t("footer_how_it_works")}</Link>
              </li>
              <li>
                <FooterDemoLink label={t("footer_book_demo")} />
              </li>
              <li>
                <Link href="/login">{t("footer_login")}</Link>
              </li>
            </ul>
          </nav>

          <nav className="vyf-col" aria-label={t("footer_col_help")}>
            <h3 className="vyf-col-title">{t("footer_col_help")}</h3>
            <ul>
              <li>
                <Link href="/help" {...helpTarget}>
                  {t("footer_all_articles")}
                </Link>
              </li>
              {helpCols.map((c) => (
                <li key={c.slug}>
                  <Link href={`/help/${c.slug}`} {...helpTarget}>
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav className="vyf-col" aria-label={tf("contact")}>
            <h3 className="vyf-col-title">{tf("contact")}</h3>
            <ul>
              <li>
                <Link href="/contact">{t("footer_contact")}</Link>
              </li>
              <li>
                <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
              </li>
              {VYLAN_PHONES.map((p) => (
                <li key={p.tel}>
                  <a href={`tel:${p.tel}`}>{p.label}</a>
                </li>
              ))}
              <li>
                <span className="vyf-muted">{t("contact_location_value")}</span>
              </li>
            </ul>
          </nav>

          <nav className="vyf-col" aria-label={t("footer_col_legal")}>
            <h3 className="vyf-col-title">{t("footer_col_legal")}</h3>
            <ul>
              <li>
                <Link href="/privacy">{tf("privacy")}</Link>
              </li>
              <li>
                <Link href="/terms">{tf("terms")}</Link>
              </li>
            </ul>
          </nav>
        </div>

        <div className="vyf-bottom">
          <div>{t("footer_copyright")}</div>
          <div className="vyf-bottom-contact">
            <a href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a>
            <span>{t("contact_location_value")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

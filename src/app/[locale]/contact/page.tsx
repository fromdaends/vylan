import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { Mail, Phone, MapPin } from "lucide-react";
import { schibsted } from "@/components/vylan-landing/fonts";
import { BirdVideo } from "@/components/vylan-landing/bird-video";
import { VylanMenu } from "@/components/vylan-landing/vylan-menu";
import { LeadForm } from "@/components/vylan-landing/lead-form";
import {
  VylanFooter,
  VYLAN_PHONES,
} from "@/components/vylan-landing/vylan-footer";
import { brand } from "@/lib/brand";
import "@/styles/vylan-landing.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Vylan" });
  return { title: `${t("contact_title")}: Vylan` };
}

// Standalone Contact page. Reuses the manifesto's page chrome (dark canvas +
// bird video, the shared slide-down VylanMenu, the back link) so it reads as a
// real sub-page rather than a landing section. The contact cards reuse the
// .vy-contact* styles; the lead form (id "vy-get-access") is the same one the
// landing and manifesto render, so the shared footer's "book a demo" anchor
// resolves here too.
export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const t = await getTranslations("Vylan");
  // Reuse the manifesto's "back" label rather than minting a duplicate key.
  const tm = await getTranslations("VylanManifesto");

  // Same menu strings the landing + manifesto build (all in the Vylan
  // namespace), so the shared VylanMenu shows identical options everywhere.
  // Resolved, locale-prefixed /help URL. The help center opens in a new
  // tab (founder spec), so it needs a real href rather than a route push.
  const helpHref = getPathname({ locale, href: "/help" });

  const menu = {
    brand: t("brand_word"),
    logoAlt: t("logo_alt"),
    menuLabel: t("menu_label"),
    closeLabel: t("menu_close"),
    defTerm: t("menu_def_term"),
    defAbbr: t("menu_def_abbr"),
    defText: t("menu_def_text"),
    navHome: t("nav_home"),
    navHowItWorks: t("nav_how_it_works"),
    navBookDemo: t("nav_book_demo"),
    navLogin: t("nav_login"),
    navContact: t("nav_contact"),
    navHelp: t("nav_help"),
    follow: t("follow"),
  };

  const footer = {
    brand: t("brand_word"),
    howItWorks: t("footer_how_it_works"),
    bookDemo: t("footer_book_demo"),
    contact: t("footer_contact"),
    login: t("footer_login"),
    help: t("footer_help"),
    copyright: t("footer_copyright"),
    location: t("contact_location_value"),
  };

  return (
    <div className={`vy-manifesto vy-contactpage ${schibsted.variable}`}>
      <BirdVideo />

      {/* centred brand + shared slide-down menu (opens on hover) */}
      <VylanMenu s={menu} helpHref={helpHref} />

      {/* back to the landing — kept top-right */}
      <div className="vy-topbar">
        <Link className="vy-back" href="/">
          <span className="vy-arr">←</span> {tm("back")}
        </Link>
      </div>

      <main className="vy-manifesto-main">
        <span className="vy-pill">{t("nav_contact")}</span>
        <h1>{t("contact_title")}</h1>
        <p className="vy-lede">{t("contact_lede")}</p>

        <section className="vy-contact" id="vy-contact">
          <div className="vy-contact-grid">
            <a
              className="vy-contact-card"
              href={`mailto:${brand.supportEmail}`}
            >
              <span className="vy-contact-ic" aria-hidden>
                <Mail className="size-[18px]" />
              </span>
              <span className="vy-contact-k">{t("contact_email_label")}</span>
              <span className="vy-contact-v">{brand.supportEmail}</span>
            </a>
            <div className="vy-contact-card">
              <span className="vy-contact-ic" aria-hidden>
                <Phone className="size-[18px]" />
              </span>
              <span className="vy-contact-k">{t("contact_phone_label")}</span>
              <span className="vy-contact-v">
                {VYLAN_PHONES.map((p) => (
                  <a key={p.tel} href={`tel:${p.tel}`}>
                    {p.label}
                  </a>
                ))}
              </span>
            </div>
            <div className="vy-contact-card">
              <span className="vy-contact-ic" aria-hidden>
                <MapPin className="size-[18px]" />
              </span>
              <span className="vy-contact-k">
                {t("contact_location_label")}
              </span>
              <span className="vy-contact-v">
                {t("contact_location_value")}
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* FORM — same lead form as the landing / manifesto ("book a demo") */}
      <section className="vy-form-section" id="vy-get-access">
        <LeadForm />
      </section>

      <VylanFooter s={footer} helpHref={helpHref} />
    </div>
  );
}

import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { schibsted } from "@/components/vylan-landing/fonts";
import { BirdVideo } from "@/components/vylan-landing/bird-video";
import { VylanMenu } from "@/components/vylan-landing/vylan-menu";
import { LeadForm } from "@/components/vylan-landing/lead-form";
import "@/styles/vylan-landing.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "VylanManifesto" });
  return { title: t("meta_title") };
}

// Render a string that may contain "\n" line breaks as <br/>-separated
// fragments.
function withBreaks(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => (
    <span key={i}>
      {line}
      {i < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

export default async function ManifestoPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const tm = await getTranslations("VylanManifesto");
  const tv = await getTranslations("Vylan");

  // Same menu strings the landing builds (all in the Vylan namespace), so the
  // shared VylanMenu shows identical options on both pages.
  const menu = {
    brand: tv("brand_word"),
    logoAlt: tv("logo_alt"),
    menuLabel: tv("menu_label"),
    closeLabel: tv("menu_close"),
    defTerm: tv("menu_def_term"),
    defAbbr: tv("menu_def_abbr"),
    defText: tv("menu_def_text"),
    navHome: tv("nav_home"),
    navManifesto: tv("nav_manifesto"),
    navForFirms: tv("nav_for_firms"),
    navBookDemo: tv("nav_book_demo"),
    navLogin: tv("nav_login"),
    follow: tv("follow"),
  };

  return (
    <div className={`vy-manifesto ${schibsted.variable}`}>
      <BirdVideo />

      {/* centred brand + shared slide-down menu (opens on hover) */}
      <VylanMenu s={menu} />

      {/* back to the landing — kept top-right */}
      <div className="vy-topbar">
        <Link className="vy-back" href="/">
          <span className="vy-arr">←</span> {tm("back")}
        </Link>
      </div>

      <main className="vy-manifesto-main">
        <span className="vy-pill">{tm("pill")}</span>
        <h1>{withBreaks(tm("title"))}</h1>
        <p className="vy-lede">{tm("lede")}</p>

        <div className="vy-body">
          <p>{tm("body_1")}</p>
          <p>{tm("body_2")}</p>
          <p>{tm("body_3")}</p>
          <p>
            {tm.rich("body_4", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>

        <p className="vy-kicker">{withBreaks(tm("kicker"))}</p>

        <div className="vy-signoff">
          <span className="vy-name">{tm("signoff_name")}</span>
          <a className="vy-btn" href="#vy-get-access">
            {tm("signoff_cta")}
          </a>
        </div>
      </main>

      {/* FORM — same lead form as the landing page */}
      <section className="vy-form-section" id="vy-get-access">
        <LeadForm />
      </section>

      {/* FOOTER */}
      <footer className="vy-footer">
        <div className="vy-fbrand">{tv("brand_word")}</div>
        <div className="vy-links">
          <Link href="/manifesto">{tv("footer_manifesto")}</Link>
          <a href="#vy-get-access">{tv("footer_for_firms")}</a>
          <a href="#vy-get-access">{tv("footer_book_demo")}</a>
          <Link href="/login">{tv("footer_login")}</Link>
        </div>
        <div className="vy-cr">{tv("footer_copyright")}</div>
      </footer>
    </div>
  );
}

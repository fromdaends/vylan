import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link, getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { getServerSupabase } from "@/lib/supabase/server";
import { schibsted } from "@/components/vylan-landing/fonts";
import {
  LandingShell,
  type LandingShellStrings,
} from "@/components/vylan-landing/landing-shell";
import { LeadForm } from "@/components/vylan-landing/lead-form";
import { buildLeadFormStrings } from "@/components/vylan-landing/lead-form-strings";
import "@/styles/vylan-landing.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Vylan" });
  return { title: t("meta_title") };
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // Signed-in users skip the marketing page and land on the dashboard
  // (preserved from the previous landing page — the (app)/layout handles
  // onboarding + MFA gating from there).
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) {
    redirect(getPathname({ locale, href: "/dashboard" }));
  }

  const t = await getTranslations("Vylan");

  const shellStrings: LandingShellStrings = {
    brand: t("brand_word"),
    logoAlt: t("logo_alt"),
    menuLabel: t("menu_label"),
    closeLabel: t("menu_close"),
    headline: t("hero_headline"),
    subPrefix: t("hero_subprefix"),
    reelWords: t.raw("reel_words") as string[],
    brandWord: t("brand_word"),
    ctaBook: t("cta_book"),
    ctaManifesto: t("cta_manifesto"),
    defTerm: t("menu_def_term"),
    defAbbr: t("menu_def_abbr"),
    defText: t("menu_def_text"),
    navHome: t("nav_home"),
    navManifesto: t("nav_manifesto"),
    navForFirms: t("nav_for_firms"),
    navBookDemo: t("nav_book_demo"),
    navLogin: t("nav_login"),
    follow: t("follow"),
  };

  const formStrings = buildLeadFormStrings(t);

  return (
    <main className={`vy-root ${schibsted.variable}`}>
      <LandingShell s={shellStrings} />

      {/* FORM */}
      <section className="vy-form-section" id="vy-get-access">
        <LeadForm s={formStrings} />
      </section>

      {/* FEATURES */}
      <div className="vy-features">
        <div className="vy-feature">
          <div className="vy-k">{t("feat_1_k")}</div>
          <h3>{t("feat_1_title")}</h3>
          <p>{t("feat_1_body")}</p>
        </div>
        <div className="vy-feature">
          <div className="vy-k">{t("feat_2_k")}</div>
          <h3>{t("feat_2_title")}</h3>
          <p>{t("feat_2_body")}</p>
        </div>
        <div className="vy-feature">
          <div className="vy-k">{t("feat_3_k")}</div>
          <h3>{t("feat_3_title")}</h3>
          <p>{t("feat_3_body")}</p>
        </div>
      </div>

      {/* FOOTER */}
      <footer className="vy-footer">
        <div className="vy-fbrand">{t("brand_word")}</div>
        <div className="vy-links">
          <Link href="/manifesto">{t("footer_manifesto")}</Link>
          <a href="#vy-get-access">{t("footer_for_firms")}</a>
          <a href="#vy-get-access">{t("footer_book_demo")}</a>
          <Link href="/login">{t("footer_login")}</Link>
        </div>
        <div className="vy-cr">{t("footer_copyright")}</div>
      </footer>
    </main>
  );
}

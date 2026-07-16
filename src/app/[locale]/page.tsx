import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getPathname, Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { getServerSupabase } from "@/lib/supabase/server";
import { schibsted } from "@/components/vylan-landing/fonts";
import {
  LandingShell,
  type LandingShellStrings,
} from "@/components/vylan-landing/landing-shell";
import { LeadForm } from "@/components/vylan-landing/lead-form";
import { VylanFooter } from "@/components/vylan-landing/vylan-footer";
import "@/styles/vylan-landing.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Vylan" });
  return { title: t("meta_title"), description: t("meta_description") };
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
    ctaHowItWorks: t("cta_how_it_works"),
    defTerm: t("menu_def_term"),
    defAbbr: t("menu_def_abbr"),
    defText: t("menu_def_text"),
    navHome: t("nav_home"),
    navHowItWorks: t("nav_how_it_works"),
    navBookDemo: t("nav_book_demo"),
    navLogin: t("nav_login"),
    navContact: t("nav_contact"),
    follow: t("follow"),
  };

  const footer = {
    brand: t("brand_word"),
    howItWorks: t("footer_how_it_works"),
    bookDemo: t("footer_book_demo"),
    contact: t("footer_contact"),
    login: t("footer_login"),
    copyright: t("footer_copyright"),
    location: t("contact_location_value"),
  };

  return (
    <main className={`vy-root ${schibsted.variable}`}>
      <LandingShell s={shellStrings} />

      {/* FORM — the 3-phase demo-lead flow (see LeadForm) */}
      <section className="vy-form-section" id="vy-get-access">
        <LeadForm />
      </section>

      {/* CALL TO ACTION — invites visitors to the full "How it works" page
          (replaced the old 3-up feature grid). */}
      <section className="vy-home-cta">
        <h2 className="vy-home-cta-title">{t("home_cta_title")}</h2>
        <Link className="vy-btn" href="/how-it-works">
          {t("cta_how_it_works")}
        </Link>
      </section>

      {/* FOOTER (Contact now lives on its own /contact page; the footer keeps
          the details in a small faint line) */}
      <VylanFooter s={footer} />
    </main>
  );
}

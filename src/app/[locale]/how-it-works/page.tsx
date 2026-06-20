import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { schibsted } from "@/components/vylan-landing/fonts";
import { VylanMenu } from "@/components/vylan-landing/vylan-menu";
import { HowItWorksShell } from "@/components/vylan-landing/how-it-works-shell";
import { LeadForm } from "@/components/vylan-landing/lead-form";
import { VylanFooter } from "@/components/vylan-landing/vylan-footer";
import "@/styles/vylan-landing.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "VylanHowItWorks" });
  return { title: t("meta_title") };
}

export default async function HowItWorksPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const t = await getTranslations("VylanHowItWorks");
  const tv = await getTranslations("Vylan");

  const strings = {
    heroEyebrow: t("hero_eyebrow"),
    heroTitle: t("hero_title"),
    heroSub: t("hero_sub"),
    ctaBook: t("cta_book"),
    problemEyebrow: t("problem_eyebrow"),
    problemTitle: t("problem_title"),
    problemChips: [
      t("problem_chip_1"),
      t("problem_chip_2"),
      t("problem_chip_3"),
      t("problem_chip_4"),
    ],
    problemBody: t("problem_body"),
    stepsEyebrow: t("steps_eyebrow"),
    stepsTitle: t("steps_title"),
    steps: [
      { kicker: t("step1_kicker"), title: t("step1_title"), body: t("step1_body") },
      { kicker: t("step2_kicker"), title: t("step2_title"), body: t("step2_body") },
      { kicker: t("step3_kicker"), title: t("step3_title"), body: t("step3_body") },
      { kicker: t("step4_kicker"), title: t("step4_title"), body: t("step4_body") },
    ],
    payEyebrow: t("pay_eyebrow"),
    payTitlePre: t("pay_title_pre"),
    payTitleWord: t("pay_title_word"),
    payBody: t("pay_body"),
    paySteps: [
      { title: t("pay_step1_title"), body: t("pay_step1_body") },
      { title: t("pay_step2_title"), body: t("pay_step2_body") },
      { title: t("pay_step3_title"), body: t("pay_step3_body") },
    ],
    payCaption: t("pay_caption"),
    trustEyebrow: t("trust_eyebrow"),
    trustTitle: t("trust_title"),
    trustIntro: t("trust_intro"),
    trustCards: [
      { title: t("trust_1_title"), body: t("trust_1_body"), badge: t("trust_1_badge") },
      { title: t("trust_2_title"), body: t("trust_2_body"), badge: t("trust_2_badge") },
      { title: t("trust_3_title"), body: t("trust_3_body") },
      { title: t("trust_4_title"), body: t("trust_4_body") },
    ],
    closeTitle: t("close_title"),
  };

  // Same menu + footer strings the landing builds (all in the Vylan namespace),
  // so the shared chrome shows identical options on every marketing page.
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

  return (
    <div className={`vy-wwd ${schibsted.variable}`}>
      {/* centred brand + shared slide-down menu (opens on hover) */}
      <VylanMenu s={menu} />

      <HowItWorksShell s={strings} />

      {/* FORM — same lead form as the landing page; every "Book a demo"
          button on this page smooth-scrolls here. */}
      <section className="vy-form-section" id="vy-get-access">
        <LeadForm />
      </section>

      <VylanFooter s={footer} />
    </div>
  );
}

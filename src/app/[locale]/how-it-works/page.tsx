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
  // The product's own stage names, read straight from the app's namespace so
  // the demo below can't drift from what a client actually sees.
  const tStage = await getTranslations("Stage");

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
    // The playable stage-board demo. Its five stage names come from the
    // PRODUCT's own namespace, not a marketing copy of them: the design took
    // them verbatim from the app, and a page that promises stages the product
    // doesn't have is the kind of drift nobody notices until a demo. Rename a
    // stage and this follows. "Paid" is the demo's own resting state (the
    // product calls it Completed — here the money is the point).
    workflow: {
      eyebrow: t("wa_eyebrow"),
      title: t("wa_title"),
      body: t("wa_body"),
      panelLabel: t("wa_panel_label"),
      play: t("wa_play"),
      playing: t("wa_playing"),
      replay: t("wa_replay"),
      all: t("wa_all"),
      moved: t("wa_moved"),
      empty: t("wa_empty"),
      foot: t("wa_foot"),
      stageLabels: [
        tStage("stage_collecting"),
        tStage("stage_in_review"),
        tStage("stage_in_preparation"),
        tStage("stage_awaiting_signature"),
        tStage("stage_awaiting_payment"),
        t("wa_paid"),
      ],
      rows: [
        { name: t("wa_row1_name"), sub: t("wa_row1_sub") },
        { name: t("wa_row2_name"), sub: t("wa_row2_sub") },
        { name: t("wa_row3_name"), sub: t("wa_row3_sub") },
        { name: t("wa_row4_name"), sub: t("wa_row4_sub") },
      ],
    },
    payEyebrow: t("pay_eyebrow"),
    payTitlePre: t("pay_title_pre"),
    payTitleWord: t("pay_title_word"),
    payBody: t("pay_body"),
    paySteps: [
      { title: t("pay_step1_title"), body: t("pay_step1_body") },
      { title: t("pay_step2_title"), body: t("pay_step2_body") },
      { title: t("pay_step3_title"), body: t("pay_step3_body") },
    ],
    payStatBig: t("pay_stat_big"),
    payStatUnit: t("pay_stat_unit"),
    payStatTitle: t("pay_stat_title"),
    payStatBody: t("pay_stat_body"),
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

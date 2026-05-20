import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link, getPathname } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { assertLocale } from "@/lib/locale";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  ArrowRight,
  Check,
  Sparkles,
  Bell,
  FileCheck,
  Clock,
  Rocket,
  ShieldCheck,
  X,
} from "lucide-react";
import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";
import { ScrollReveal, ParallaxLayer } from "@/components/public/scroll-reveal";
import { AiCardReveal, AiSideReveal } from "@/components/public/ai-card-reveal";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // Signed-in users skip the marketing page and land directly on the
  // dashboard. The (app)/layout below /dashboard handles onboarding +
  // MFA gating, so we don't duplicate that here — one extra redirect
  // hop is fine and keeps this file simple.
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user) {
    redirect(getPathname({ locale, href: "/dashboard" }));
  }

  const t = await getTranslations("Landing");
  const tAuth = await getTranslations("Auth");

  // No pt-* on <main> here (other public pages keep it). The hero
  // section needs its orb halo to bleed up through the floating pill
  // — without that, the orbs get clipped at the bottom of main's
  // padding and paint a hard horizontal line right under the nav
  // (the "line that blocks ambient lighting"). The hero content's
  // own top padding (pt-28 sm:pt-36 below) handles pill clearance.
  return (
    <main className="relative flex-1 flex flex-col overflow-hidden ambient-warm">
      <PublicNav />

      {/* HERO */}
      <section className="relative overflow-hidden">
        {/* Hero halo — a warm multi-color cluster behind the headline.
            Iris keystone overhead, rose + coral at the corners, gold
            + peach below, pink accent low. Masked into a soft ellipse
            so the colors don't bleed into the intro section below.
            The whole cluster drifts on the scroll timeline so the
            backdrop feels alive both directions. */}
        <ParallaxLayer
          intensity={120}
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_70%_85%_at_50%_30%,black,transparent_70%)]"
        >
          {/* Hero halo — dense central cluster (10 overlapping orbs).
              Each orb runs a slow drift (`orb-drift-center` /
              `orb-drift-side`) with co-prime durations + offset
              delays so the cluster breathes without ever looping.
              `orb-drift-center` bakes `translate(-50%, 0)` into
              every step so the animation transform doesn't fight
              Tailwind's `-translate-x-1/2`; the Tailwind class stays
              as the fallback for `prefers-reduced-motion: reduce`.
              Orbs use `mix-blend-mode: multiply` (light) / `screen`
              (dark) so overlapping zones actually MESH into new
              hues — denser stacking + bigger sizes + larger blur
              (80px) here mean the cluster reads as one warm wash,
              not a constellation of separate circles. */}
          <div aria-hidden>
            {/* Iris keystone — large purple-blue wash above the
                headline. Anchors the cool end of the palette. */}
            <div
              className="orb orb-iris orb-drift-center h-[900px] w-[900px] top-[-240px] left-1/2 -translate-x-1/2 opacity-100"
              style={{ animationDuration: "47s" }}
            />
            {/* Rose + coral flank the headline — pulled in a touch
                from 22% to 16% so they overlap the iris keystone
                more. */}
            <div
              className="orb orb-rose orb-drift-side h-[540px] w-[540px] top-[60px] left-[16%] opacity-95"
              style={{ animationDuration: "23s", animationDelay: "-3s" }}
            />
            <div
              className="orb orb-coral orb-drift-side h-[540px] w-[540px] top-[60px] right-[16%] opacity-95"
              style={{ animationDuration: "29s", animationDelay: "-7s" }}
            />
            {/* Peach mid-zone — fills the gap between the side
                orbs and the centre column so there's no dark
                "seam" left/right of the headline. */}
            <div
              className="orb orb-peach orb-drift-side h-[400px] w-[400px] top-[220px] left-[30%] opacity-90"
              style={{ animationDuration: "31s", animationDelay: "-13s" }}
            />
            <div
              className="orb orb-peach orb-drift-side h-[400px] w-[400px] top-[220px] right-[30%] opacity-90"
              style={{ animationDuration: "37s", animationDelay: "-17s" }}
            />
            {/* Warm gold behind the CTA row. */}
            <div
              className="orb orb-gold orb-drift-center h-[520px] w-[520px] top-[280px] left-1/2 -translate-x-1/2 opacity-95"
              style={{ animationDuration: "41s", animationDelay: "-5s" }}
            />
            {/* Pink lower-centre carries the cluster down past the
                CTAs. */}
            <div
              className="orb orb-pink orb-drift-center h-[460px] w-[460px] top-[440px] left-1/2 -translate-x-1/2 opacity-90"
              style={{ animationDuration: "43s", animationDelay: "-9s" }}
            />
            {/* Small rose + coral lower satellites add bottom-corner
                warmth so the bottom of the halo isn't just iris. */}
            <div
              className="orb orb-rose orb-drift-side h-[280px] w-[280px] top-[460px] left-[30%] opacity-80"
              style={{ animationDuration: "53s", animationDelay: "-19s" }}
            />
            <div
              className="orb orb-coral orb-drift-side h-[280px] w-[280px] top-[460px] right-[30%] opacity-80"
              style={{ animationDuration: "59s", animationDelay: "-23s" }}
            />
            {/* Iris satellite tucks under the cluster and bleeds
                into the intro section transition. */}
            <div
              className="orb orb-iris orb-drift-center h-[360px] w-[360px] top-[540px] left-1/2 -translate-x-1/2 opacity-65"
              style={{ animationDuration: "61s", animationDelay: "-11s" }}
            />
          </div>
        </ParallaxLayer>

        <div className="mx-auto max-w-4xl px-6 pt-28 sm:pt-36 pb-24 sm:pb-32 text-center animate-in-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 backdrop-blur px-4 py-1.5 text-xs font-medium mb-8">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span className="text-foreground">
              {brand.tagline[locale] ?? t("subhead")}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">v1.0</span>
          </div>
          <h1 className="text-5xl sm:text-7xl md:text-8xl font-semibold tracking-tight leading-[0.95] text-gradient-warm">
            {t("headline")}
          </h1>
          <p className="mt-8 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {t("subhead")}
          </p>
          <div className="mt-12 flex flex-wrap gap-3 justify-center">
            {/* Single primary CTA. Routes to /pricing so the user
                picks a plan first; the plan page hands off to
                /signup?plan=<id> with the 14-day trial pre-applied. */}
            <Link href="/pricing">
              <Button size="lg" className="press h-12 px-6 text-base glow-accent">
                {t("cta_primary")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-success" />
              {t("trust_cancel")}
            </div>
          </div>
        </div>
      </section>

      {/* INTRO — the bigger welcome / explainer */}
      <section className="relative">
        <div className="mx-auto max-w-4xl px-6 py-28 sm:py-36 text-center">
          {/* intensity="soft" (translate-only, no scale) — animating
              scale on a parent that contains a .text-gradient child
              triggers per-frame rasterization of background-clip:text
              and produces visible jitter on hi-DPI displays. */}
          <ScrollReveal intensity="soft">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
              {t("intro_eyebrow")}
            </div>
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] text-gradient">
              {t("intro_title")}
            </h2>
            <p className="mt-8 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {t("intro_lede")}
            </p>
          </ScrollReveal>
          <ScrollReveal delay={0.15} className="mt-10 flex flex-wrap justify-center gap-2.5">
            <IntroPill>{t("intro_pill_1")}</IntroPill>
            <IntroPill>{t("intro_pill_2")}</IntroPill>
            <IntroPill>{t("intro_pill_3")}</IntroPill>
          </ScrollReveal>
        </div>
      </section>

      {/* BENEFITS — big stat cards */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <ScrollReveal intensity="strong" className="text-center mb-16">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              {t("benefits_eyebrow")}
            </div>
            <h2 className="text-3xl sm:text-5xl font-semibold tracking-tight max-w-3xl mx-auto leading-tight">
              {t("benefits_title")}
            </h2>
          </ScrollReveal>
          <div className="grid gap-5 md:grid-cols-3">
            <ScrollReveal intensity="pop" delay={0}>
              <BenefitCard
                icon={<Clock className="h-5 w-5" />}
                stat={t("benefit_1_stat")}
                label={t("benefit_1_label")}
                title={t("benefit_1_title")}
                body={t("benefit_1_body")}
              />
            </ScrollReveal>
            <ScrollReveal intensity="pop" delay={0.1}>
              <BenefitCard
                icon={<Rocket className="h-5 w-5" />}
                stat={t("benefit_2_stat")}
                label={t("benefit_2_label")}
                title={t("benefit_2_title")}
                body={t("benefit_2_body")}
              />
            </ScrollReveal>
            <ScrollReveal intensity="pop" delay={0.2}>
              <BenefitCard
                icon={<ShieldCheck className="h-5 w-5" />}
                stat={t("benefit_3_stat")}
                label={t("benefit_3_label")}
                title={t("benefit_3_title")}
                body={t("benefit_3_body")}
              />
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* AI Document Checks — dedicated centerpiece section.
          Two-column on desktop, mock card on the right. The card
          carries its own animated aurora glow (via <AiCardReveal>),
          so the section-level ParallaxLayer halo that used to sit
          here was removed — it was leaving a stray iris orb visible
          off to the right of the card. */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            {/* AiSideReveal — a distinct entrance reserved for the AI
                section. Blur-clear + lift over 1.1s reads differently
                from the standard fade-up that the rest of the page
                uses, so this section pops. */}
            <AiSideReveal lateExit>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
                {t("ai_eyebrow")}
              </div>
              <h2 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.05] text-gradient-warm">
                {t("feature_3_title")}
              </h2>
              <p className="mt-6 text-base sm:text-lg text-muted-foreground leading-relaxed">
                {t("ai_body_long")}
              </p>
              {/* AI-specific bullets. The previous list reused the global
                  intro pills (Bilingual by default / Quebec-hosted data),
                  which made them appear twice on the page. These four
                  bullets are scoped to what the AI itself does. */}
              <ul className="mt-8 space-y-3 text-sm">
                <BulletItem>{t("ai_bullet_1")}</BulletItem>
                <BulletItem>{t("ai_bullet_2")}</BulletItem>
                <BulletItem>{t("ai_bullet_3")}</BulletItem>
                <BulletItem>{t("ai_bullet_4")}</BulletItem>
              </ul>
            </AiSideReveal>
            <AiCardReveal lateExit>
              <AiMockCard t={t} />
            </AiCardReveal>
          </div>
        </div>
      </section>

      {/* AI Document Checks — success-state mirror sub-section.
          Same shell as the rejection sub-section above (max-w-6xl,
          py-28 sm:py-32, gap-12, md:grid-cols-2, md:items-center)
          so the two visually pair as a before/after.
          JSX order is reversed (card first, side text second) so:
            - on desktop the card sits in column 1 (left) and the
              text in column 2 (right) — the mirror of the section
              above;
            - on mobile (single column) the card stacks first,
              reinforcing the "result you get" framing.
          The card swoops in from the LEFT via
          <AiCardReveal direction="left">, mirroring the right-swoop
          of the rejection card. The aurora glow uses variant="success"
          which swaps the iris/purple/pink/cyan blobs for green hues
          (see .ai-card-glow.variant-success in globals.css). */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            <AiCardReveal direction="left" variant="success" lateExit>
              <AiMockCard t={t} variant="success" />
            </AiCardReveal>
            <AiSideReveal lateExit>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
                {t("ai_eyebrow")}
              </div>
              <h2 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.05] text-gradient-warm">
                {t("ai_v2_title")}
              </h2>
              <p className="mt-6 text-base sm:text-lg text-muted-foreground leading-relaxed">
                {t("ai_v2_body")}
              </p>
              <ul className="mt-8 space-y-3 text-sm">
                <BulletItem variant="success">{t("ai_v2_bullet_1")}</BulletItem>
                <BulletItem variant="success">{t("ai_v2_bullet_2")}</BulletItem>
                <BulletItem variant="success">{t("ai_v2_bullet_3")}</BulletItem>
                <BulletItem variant="success">{t("ai_v2_bullet_4")}</BulletItem>
              </ul>
            </AiSideReveal>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <ScrollReveal intensity="strong" className="text-center mb-16">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              {t("features_eyebrow")}
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {t("features_title")}
            </h2>
          </ScrollReveal>
          <div className="grid gap-6 sm:grid-cols-2 max-w-3xl mx-auto">
            <ScrollReveal intensity="pop" delay={0}>
              <Feature
                icon={<FileCheck className="h-5 w-5" />}
                title={t("feature_1_title")}
                body={t("feature_1_body")}
              />
            </ScrollReveal>
            <ScrollReveal intensity="pop" delay={0.1}>
              <Feature
                icon={<Bell className="h-5 w-5" />}
                title={t("feature_2_title")}
                body={t("feature_2_body")}
              />
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <ScrollReveal intensity="strong" className="text-center mb-16">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              {t("how_eyebrow")}
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {t("how_title")}
            </h2>
          </ScrollReveal>
          <div className="grid gap-8 sm:grid-cols-3">
            <ScrollReveal intensity="pop" delay={0}>
              <Step n={1} title={t("step_1_title")} body={t("step_1_body")} />
            </ScrollReveal>
            <ScrollReveal intensity="pop" delay={0.12}>
              <Step n={2} title={t("step_2_title")} body={t("step_2_body")} />
            </ScrollReveal>
            <ScrollReveal intensity="pop" delay={0.24}>
              <Step n={3} title={t("step_3_title")} body={t("step_3_body")} />
            </ScrollReveal>
          </div>
        </div>
      </section>

      {/* Pricing + FAQ sections removed from the landing page. The
          pricing content lives on its own page at /pricing (reachable
          via the "See pricing" hero button + the nav). FAQ content
          moves into the help-center dropdown in the nav (Tutorials /
          Questions / Contact us). The PlanPreview + Faq helper
          components below stay in place — they're reused on the
          dedicated /pricing + (forthcoming) /faq pages. */}

      {/* Final CTA */}
      <section className="relative">
        {/* intensity="soft" because the title uses .text-gradient —
            scale + background-clip:text triggers per-frame gradient
            re-rasterization (jitter on hi-DPI). Translate only. */}
        <ScrollReveal
          intensity="soft"
          className="mx-auto max-w-3xl px-6 py-24 text-center"
        >
          <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight text-gradient">
            {t("cta_final_title")}
          </h2>
          <p className="mt-6 text-base text-muted-foreground max-w-xl mx-auto">
            {t("cta_final_body")}
          </p>
          <div className="mt-10 flex flex-wrap gap-3 justify-center">
            <Link href="/pricing">
              <Button size="lg" className="press h-12 px-6 text-base glow-accent">
                {t("cta_primary")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          {/* FAQ moved out of the public nav into this small link
              under the bottom CTA — keeps the nav pill focused on
              sign-in while giving curious visitors a way to dig
              deeper before they commit. */}
          <p className="mt-6 text-sm text-muted-foreground">
            <Link
              href="/faq"
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("cta_faq_link")}
            </Link>
          </p>
        </ScrollReveal>
      </section>

      <PublicFooter />
    </main>
  );
}

function IntroPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="press cursor-default select-none inline-flex items-center gap-1.5 rounded-full border border-border bg-card/80 backdrop-blur px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-accent/50 hover:text-foreground hover:bg-accent/5">
      <span className="h-1.5 w-1.5 rounded-full bg-accent transition-transform group-hover:scale-125" />
      {children}
    </span>
  );
}

function BulletItem({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  /** "default" = iris accent check (used in the AI rejection sub-
   *  section). "success" = was green, now also the iris accent
   *  blue per user request — the bullets in the AI approval
   *  sub-section read more cleanly in blue than in green. Kept as
   *  a separate variant so we can dial it independently later if
   *  the success state ever needs a distinct treatment again. */
  variant?: "default" | "success";
}) {
  return (
    <li className="flex items-start gap-2.5 text-muted-foreground">
      <Check
        className={
          "h-4 w-4 mt-0.5 shrink-0 " +
          (variant === "success" ? "text-accent" : "text-accent")
        }
        aria-hidden
      />
      <span className="leading-relaxed text-foreground/85">{children}</span>
    </li>
  );
}

// Mock card for the AI Document Checks section. Two variants share
// the same structure (filename header, badge, file-preview area,
// callout box at the bottom). The animated multi-colour glow behind
// the card comes from <AiCardReveal>'s `.ai-card-glow` sibling div.
//
//   variant="warning"  →  the rejection / problem state (default).
//                         Red destructive tokens, em-dash in
//                         filename, no decoration on the file icon,
//                         body warns about the wrong slip.
//   variant="success"  →  the approval / mirror state. Green success
//                         tokens, hyphen in filename, small green
//                         check badge overlapping the file icon,
//                         body confirms everything is filed.
function AiMockCard({
  t,
  variant = "warning",
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Landing">>>;
  variant?: "warning" | "success";
}) {
  const isSuccess = variant === "success";
  return (
    <div
      className={
        "relative rounded-2xl border border-border bg-card p-5 sm:p-6 " +
        "transition-transform duration-300 ease-out hover:scale-[1.03] " +
        "motion-reduce:transition-none motion-reduce:hover:scale-100"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {isSuccess ? "T4 - 2025" : "T4 — 2025"}
        </p>
        <span
          className={
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider " +
            (isSuccess
              ? "bg-success/15 text-success"
              : "bg-destructive/15 text-destructive")
          }
        >
          {isSuccess ? t("ai_v2_card_badge") : t("benefit_3_label")}
        </span>
      </div>
      <div
        className="relative mt-4 rounded-lg border border-border/60 bg-muted/40 aspect-[4/3] overflow-hidden"
        aria-hidden
      >
        {/* T4 slip skeleton — neutral grey shapes that read as a
            real Canadian tax slip without showing any actual text.
            Four bands stacked top to bottom:
              1. Form header   — title row + small "form-number stamp"
                                 box on the right (CRA-style).
              2. Employer/Employee block — two columns, each with a
                                 small section header + three info
                                 lines.
              3. Amount grid   — 2 rows × 3 cols of labelled boxes,
                                 each with a "box-number marker" + a
                                 short label, and a value bar whose
                                 width varies per cell (some filled,
                                 some empty) so the grid reads as a
                                 real-world partially-filled slip.
              4. Footer        — signature underline + a short date
                                 underline, mimicking the bottom strip
                                 of an official slip. */}
        <div className="absolute inset-0 p-4 sm:p-5 flex flex-col gap-2.5">
          {/* 1. Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 flex-1">
              <div className="h-2 w-2/5 rounded-sm bg-foreground/25" />
              <div className="h-1.5 w-3/5 rounded-sm bg-foreground/10" />
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="h-1 w-10 rounded-sm bg-foreground/15" />
              <div className="h-7 w-14 rounded-sm border border-foreground/15 bg-foreground/5" />
            </div>
          </div>

          <div className="h-px w-full bg-foreground/10" />

          {/* 2. Employer / Employee columns */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="h-1 w-10 rounded-sm bg-foreground/25" />
              <div className="h-1.5 w-full rounded-sm bg-foreground/10" />
              <div className="h-1.5 w-4/5 rounded-sm bg-foreground/10" />
              <div className="h-1.5 w-3/5 rounded-sm bg-foreground/10" />
            </div>
            <div className="space-y-1">
              <div className="h-1 w-10 rounded-sm bg-foreground/25" />
              <div className="h-1.5 w-full rounded-sm bg-foreground/10" />
              <div className="h-1.5 w-3/5 rounded-sm bg-foreground/10" />
              <div className="h-1.5 w-4/5 rounded-sm bg-foreground/10" />
            </div>
          </div>

          {/* 3. Amount grid */}
          <div className="grid grid-cols-3 gap-1.5 mt-0.5">
            {[
              { fill: 0.75 },
              { fill: 0.6 },
              { fill: 0 },
              { fill: 0.85 },
              { fill: 0.5 },
              { fill: 0 },
            ].map((cell, i) => (
              <div
                key={i}
                className="rounded-sm border border-foreground/15 px-1.5 py-1 space-y-1"
              >
                <div className="flex items-center gap-1">
                  <div className="h-1.5 w-3 rounded-sm bg-foreground/25" />
                  <div className="h-1 w-6 rounded-sm bg-foreground/10" />
                </div>
                <div
                  className={
                    "h-2 rounded-sm " +
                    (cell.fill > 0
                      ? "bg-foreground/15"
                      : "bg-foreground/[0.03]")
                  }
                  style={cell.fill > 0 ? { width: `${cell.fill * 100}%` } : { width: "100%" }}
                />
              </div>
            ))}
          </div>

          {/* 4. Footer */}
          <div className="mt-auto flex items-end justify-between gap-3 pt-0.5">
            <div className="flex-1 space-y-1">
              <div className="h-px w-3/4 bg-foreground/25" />
              <div className="h-1 w-1/3 rounded-sm bg-foreground/10" />
            </div>
            <div className="space-y-1">
              <div className="h-px w-12 bg-foreground/25" />
              <div className="h-1 w-8 rounded-sm bg-foreground/10" />
            </div>
          </div>
        </div>

        {/* Status badge — pinned to the top-right corner of the
            preview itself (was previously docked to the centered
            file icon). Same colour/sizing tokens as before. */}
        {isSuccess ? (
          <span
            className={
              "absolute top-3 right-3 inline-flex h-7 w-7 " +
              "items-center justify-center rounded-full bg-success " +
              "text-success-foreground ring-2 ring-card shadow-sm"
            }
            aria-hidden
          >
            <Check className="h-4 w-4" aria-hidden />
          </span>
        ) : (
          <span
            className={
              "absolute top-3 right-3 inline-flex h-7 w-7 " +
              "items-center justify-center rounded-full bg-destructive " +
              "text-destructive-foreground ring-2 ring-card shadow-sm"
            }
            aria-hidden
          >
            <X className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <div
        className={
          "mt-4 rounded-lg px-4 py-3 " +
          (isSuccess
            ? "border border-success/40 bg-success/5"
            : "border border-destructive/40 bg-destructive/5")
        }
      >
        <p
          className={
            "text-xs sm:text-sm font-semibold " +
            (isSuccess ? "text-success" : "text-destructive")
          }
        >
          {isSuccess ? t("ai_v2_card_callout_title") : t("feature_3_title")}
        </p>
        <p className="mt-1 text-xs sm:text-sm text-foreground/80 leading-relaxed">
          {isSuccess ? t("ai_v2_card_callout_body") : t("feature_3_body")}
        </p>
      </div>
    </div>
  );
}

function BenefitCard({
  icon,
  stat,
  label,
  title,
  body,
}: {
  icon: React.ReactNode;
  stat: string;
  label: string;
  title: string;
  body: string;
}) {
  return (
    <div className="tilt group relative overflow-hidden rounded-2xl border border-border bg-card p-7">
      <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="flex items-center justify-between">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 transition-transform group-hover:scale-110 group-hover:rotate-3">
          {icon}
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tracking-tight num-display text-gradient">
            {stat}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
            {label}
          </div>
        </div>
      </div>
      <div className="mt-7">
        <div className="font-medium text-base">{title}</div>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          {body}
        </p>
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="tilt group relative rounded-2xl border border-border bg-card p-6 hover:border-foreground/20">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-accent/20 mb-4 transition-transform group-hover:scale-110 group-hover:rotate-3">
        {icon}
      </div>
      <div className="font-medium text-base mb-1.5">{title}</div>
      <p className="text-muted-foreground leading-relaxed text-sm">{body}</p>
    </div>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <div className="relative group">
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl border border-border bg-card font-mono text-lg font-medium text-foreground mb-5 shadow-sm transition-all duration-300 group-hover:border-accent/50 group-hover:bg-accent/5 group-hover:text-accent group-hover:-translate-y-0.5 group-hover:shadow-md">
        {n}
      </div>
      <div className="font-medium text-lg transition-colors group-hover:text-foreground">
        {title}
      </div>
      <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
        {body}
      </p>
    </div>
  );
}

// Faq + PlanPreview helpers extracted to:
//   src/components/public/faq-item.tsx
//   src/components/public/plan-card.tsx
// when the pricing + FAQ sections were lifted off the landing page.
// Import from there on the dedicated /pricing + /faq pages.

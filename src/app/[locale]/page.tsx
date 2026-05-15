import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { assertLocale } from "@/lib/locale";
import {
  ArrowRight,
  Check,
  Sparkles,
  Bell,
  FileCheck,
  Clock,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";
import { ScrollReveal, ParallaxLayer } from "@/components/public/scroll-reveal";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Landing");
  const tAuth = await getTranslations("Auth");

  return (
    <main className="relative flex-1 flex flex-col overflow-hidden ambient-warm pt-16">
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
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_75%_90%_at_50%_30%,black,transparent_75%)]"
        >
          <div aria-hidden>
            <div className="orb orb-iris h-[820px] w-[820px] top-[-220px] left-1/2 -translate-x-1/2 opacity-100" />
            <div
              className="orb orb-rose h-[560px] w-[560px] top-[20px] -left-[100px] opacity-100"
              style={{ animationDelay: "-3s" }}
            />
            <div
              className="orb orb-coral h-[560px] w-[560px] top-[20px] -right-[100px] opacity-100"
              style={{ animationDelay: "-7s" }}
            />
            <div
              className="orb orb-peach h-[440px] w-[440px] top-[200px] left-[10%] opacity-95"
              style={{ animationDelay: "-11s" }}
            />
            <div
              className="orb orb-gold h-[480px] w-[480px] top-[200px] right-[10%] opacity-95"
              style={{ animationDelay: "-5s" }}
            />
            <div
              className="orb orb-pink h-[360px] w-[360px] top-[420px] left-1/2 -translate-x-1/2 opacity-70"
              style={{ animationDelay: "-9s" }}
            />
          </div>
        </ParallaxLayer>

        <div className="mx-auto max-w-4xl px-6 pt-24 pb-24 sm:pt-32 sm:pb-32 text-center animate-in-up">
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
          Two-column on desktop, mock card on the right with an accent
          glow halo behind it to draw the reader's eye. The third
          "Features" card (AI) was removed in favor of this richer
          treatment so the AI message lives in one prominent place. */}
      <section className="relative">
        {/* Glow halo: large accent orb sits behind the mock card to
            give the section a warm spotlight. Parallax-drifted so it
            stays alive while reading. */}
        <ParallaxLayer
          intensity={80}
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_60%_70%_at_70%_50%,black,transparent_75%)]"
        >
          <div aria-hidden>
            <div
              className="orb orb-iris h-[640px] w-[640px] top-[40px] -right-[120px] opacity-90"
              style={{ animationDelay: "-2s" }}
            />
            <div
              className="orb orb-coral h-[420px] w-[420px] top-[260px] right-[20%] opacity-70"
              style={{ animationDelay: "-8s" }}
            />
          </div>
        </ParallaxLayer>
        <div className="mx-auto max-w-6xl px-6 py-28 sm:py-32">
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            {/* intensity="soft" because the title uses .text-gradient-warm —
                scale animations on background-clip:text re-rasterize the
                gradient every frame and jitter on hi-DPI. Translate only. */}
            <ScrollReveal intensity="soft">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
                {t("features_eyebrow")}
              </div>
              <h2 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.05] text-gradient-warm">
                {t("feature_3_title")}
              </h2>
              <p className="mt-6 text-base sm:text-lg text-muted-foreground leading-relaxed">
                {t("feature_3_body")}
              </p>
              <ul className="mt-8 space-y-3 text-sm">
                <BulletItem>{t("benefit_3_body")}</BulletItem>
                <BulletItem>{t("intro_pill_2")}</BulletItem>
                <BulletItem>{t("intro_pill_3")}</BulletItem>
              </ul>
            </ScrollReveal>
            <ScrollReveal intensity="pop" delay={0.15}>
              <AiMockCard t={t} />
            </ScrollReveal>
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

function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-muted-foreground">
      <Check className="h-4 w-4 mt-0.5 text-accent shrink-0" aria-hidden />
      <span className="leading-relaxed text-foreground/85">{children}</span>
    </li>
  );
}

// Mock card for the AI Document Checks section. Mimics what the
// accountant sees when the AI auto-rejects a file: filename header,
// "right-doc detection" badge, dark preview area, and a red rejection
// alert below explaining the issue. Sits inside a featured-card glow.
function AiMockCard({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Landing">>>;
}) {
  return (
    <div className="featured-card rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">T4 — 2025</p>
        <span className="inline-flex items-center gap-1 rounded-md bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive uppercase tracking-wider">
          {t("benefit_3_label")}
        </span>
      </div>
      <div
        className="mt-4 rounded-lg border border-border/60 bg-muted/40 aspect-[4/3] flex items-center justify-center"
        aria-hidden
      >
        <FileCheck
          className="h-10 w-10 text-muted-foreground/30"
          aria-hidden
        />
      </div>
      <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
        <p className="text-xs sm:text-sm font-semibold text-destructive">
          {t("feature_3_title")}
        </p>
        <p className="mt-1 text-xs sm:text-sm text-foreground/80 leading-relaxed">
          {t("feature_3_body")}
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

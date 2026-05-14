import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { PLANS, PAID_PLANS, type PlanId } from "@/lib/plans";
import { formatCurrency } from "@/lib/format";
import { assertLocale } from "@/lib/locale";
import {
  ArrowRight,
  Check,
  Sparkles,
  Zap,
  Bell,
  FileCheck,
  Clock,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { PublicFooter } from "@/components/public/public-footer";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Logo } from "@/components/brand/logo";

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
  const tPricing = await getTranslations("Pricing");
  const otherLocale = locale === "fr" ? "en" : "fr";

  return (
    <main className="relative flex-1 flex flex-col overflow-hidden ambient-warm">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/60">
        <div className="nav-shrink mx-auto max-w-6xl flex items-center justify-between px-6 py-3.5">
          <Link
            href="/"
            className="flex items-center gap-2.5 font-semibold tracking-tight text-lg group"
          >
            <span className="logo-shrink inline-flex">
              <Logo
                size={44}
                priority
                className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
              />
            </span>
            {brand.name}
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link href="/pricing" className="hidden sm:inline">
              <Button variant="ghost" size="sm">
                {t("nav_pricing")}
              </Button>
            </Link>
            <Link href="/" locale={otherLocale}>
              <Button variant="ghost" size="sm">
                {otherLocale.toUpperCase()}
              </Button>
            </Link>
            <ThemeToggle className="mx-1" />
            <Link href="/login">
              <Button variant="ghost" size="sm">
                {tAuth("sign_in")}
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm">
                {tAuth("create_account")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        {/* Hero halo — a warm multi-color cluster behind the headline.
            Iris keystone overhead, rose + coral at the corners, gold
            + peach below, pink accent low. Masked into a soft ellipse
            so the colors don't bleed into the intro section below.
            The whole cluster drifts on the scroll timeline so the
            backdrop feels alive both directions. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_75%_90%_at_50%_30%,black,transparent_75%)] parallax-up-slow"
        >
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
            <Link href="/signup">
              <Button size="lg" className="press h-12 px-6 text-base glow-accent">
                {t("cta_primary")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link href="/pricing">
              <Button variant="outline" size="lg" className="press h-12 px-6 text-base">
                {t("cta_secondary")}
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
          <div className="reveal-strong">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
              {t("intro_eyebrow")}
            </div>
            <h2 className="text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] text-gradient">
              {t("intro_title")}
            </h2>
            <p className="mt-8 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              {t("intro_lede")}
            </p>
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-2.5 reveal-soft">
            <IntroPill>{t("intro_pill_1")}</IntroPill>
            <IntroPill>{t("intro_pill_2")}</IntroPill>
            <IntroPill>{t("intro_pill_3")}</IntroPill>
          </div>
        </div>
      </section>

      {/* BENEFITS — big stat cards */}
      <section className="relative">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="text-center mb-16 reveal-strong">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              {t("benefits_eyebrow")}
            </div>
            <h2 className="text-3xl sm:text-5xl font-semibold tracking-tight max-w-3xl mx-auto leading-tight">
              {t("benefits_title")}
            </h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            <BenefitCard
              icon={<Clock className="h-5 w-5" />}
              stat={t("benefit_1_stat")}
              label={t("benefit_1_label")}
              title={t("benefit_1_title")}
              body={t("benefit_1_body")}
            />
            <BenefitCard
              icon={<Rocket className="h-5 w-5" />}
              stat={t("benefit_2_stat")}
              label={t("benefit_2_label")}
              title={t("benefit_2_title")}
              body={t("benefit_2_body")}
            />
            <BenefitCard
              icon={<ShieldCheck className="h-5 w-5" />}
              stat={t("benefit_3_stat")}
              label={t("benefit_3_label")}
              title={t("benefit_3_title")}
              body={t("benefit_3_body")}
            />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative">
        {/* Mid-page warm ambient — keeps the warmth carrying down
            after the hero. Drifts on the scroll timeline for depth. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_70%_70%_at_50%_50%,black,transparent_80%)] parallax-up-fast"
        >
          <div
            className="orb orb-peach h-[480px] w-[480px] top-[120px] -left-[140px] opacity-65"
            style={{ animationDelay: "-4s" }}
          />
          <div
            className="orb orb-gold h-[480px] w-[480px] top-[120px] -right-[140px] opacity-65"
            style={{ animationDelay: "-8s" }}
          />
        </div>
        <div className="mx-auto max-w-5xl px-6 py-24">
          <div className="text-center mb-16 reveal-strong">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              {t("features_eyebrow")}
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {t("features_title")}
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            <Feature
              icon={<FileCheck className="h-5 w-5" />}
              title={t("feature_1_title")}
              body={t("feature_1_body")}
            />
            <Feature
              icon={<Bell className="h-5 w-5" />}
              title={t("feature_2_title")}
              body={t("feature_2_body")}
            />
            <Feature
              icon={<Zap className="h-5 w-5" />}
              title={t("feature_3_title")}
              body={t("feature_3_body")}
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative">
        {/* Warm rose drift behind the steps. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,black,transparent_80%)] parallax-down-slow"
        >
          <div
            className="orb orb-rose h-[520px] w-[520px] top-[80px] left-1/2 -translate-x-1/2 opacity-55"
            style={{ animationDelay: "-6s" }}
          />
        </div>
        <div className="mx-auto max-w-5xl px-6 py-24">
          <div className="text-center mb-16 reveal-strong">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              {t("how_eyebrow")}
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {t("how_title")}
            </h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            <Step n={1} title={t("step_1_title")} body={t("step_1_body")} />
            <Step n={2} title={t("step_2_title")} body={t("step_2_body")} />
            <Step n={3} title={t("step_3_title")} body={t("step_3_body")} />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="relative">
        <div className="mx-auto max-w-4xl px-6 py-24">
          <div className="text-center mb-16 reveal-strong">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              {t("pricing_eyebrow")}
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {tPricing("title")}
            </h2>
            <p className="text-sm text-muted-foreground mt-4 max-w-md mx-auto">
              {tPricing("subtitle")}
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {PAID_PLANS.map((planId) => (
              <PlanPreview
                key={planId}
                planId={planId}
                locale={locale}
                featured={planId === "cabinet"}
              />
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <div className="text-center mb-12 reveal-strong">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              FAQ
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {t("faq_title")}
            </h2>
          </div>
          <dl className="space-y-2">
            <Faq q={t("faq_1_q")} a={t("faq_1_a")} />
            <Faq q={t("faq_2_q")} a={t("faq_2_a")} />
            <Faq q={t("faq_3_q")} a={t("faq_3_a")} />
            <Faq q={t("faq_4_q")} a={t("faq_4_a")} />
          </dl>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center reveal-strong">
          <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight text-gradient">
            {t("cta_final_title")}
          </h2>
          <p className="mt-6 text-base text-muted-foreground max-w-xl mx-auto">
            {t("cta_final_body")}
          </p>
          <div className="mt-10 flex flex-wrap gap-3 justify-center">
            <Link href="/signup">
              <Button size="lg" className="press h-12 px-6 text-base glow-accent">
                {t("cta_primary")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
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
    <div className="reveal tilt group relative overflow-hidden rounded-2xl border border-border bg-card p-7">
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
    <div className="reveal tilt group relative rounded-2xl border border-border bg-card p-6 hover:border-foreground/20">
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
    <div className="relative reveal group">
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

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="reveal-soft group rounded-xl border border-border bg-card transition-all duration-300 hover:border-accent/40 hover:bg-card/80 open:border-accent/40">
      <summary className="flex cursor-pointer items-center justify-between gap-4 p-5 font-medium text-base list-none">
        <span className="transition-colors group-hover:text-foreground">
          {q}
        </span>
        <span
          aria-hidden
          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground transition-all duration-300 group-hover:bg-accent/15 group-hover:text-accent group-open:rotate-45 group-open:bg-accent/15 group-open:text-accent shrink-0"
        >
          +
        </span>
      </summary>
      <div className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">
        {a}
      </div>
    </details>
  );
}

async function PlanPreview({
  planId,
  locale,
  featured = false,
}: {
  planId: PlanId;
  locale: "fr" | "en";
  featured?: boolean;
}) {
  const t = await getTranslations("Pricing");
  const plan = PLANS[planId];
  const price =
    plan.monthlyCadCents != null
      ? formatCurrency(plan.monthlyCadCents / 100, locale, 0)
      : "—";
  // Whole card links to the dedicated plan page (/pricing/solo or
  // /pricing/cabinet). The plan page hands off to /signup?plan=<id>
  // which the Stripe checkout flow will pick up once wired.
  return (
    <Link
      href={`/pricing/${planId}`}
      className={
        "reveal relative block cursor-pointer rounded-2xl border bg-card p-7 tilt no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
        (featured
          ? "featured-card border-transparent"
          : "border-border hover:border-foreground/20")
      }
    >
      {featured && (
        <span className="absolute -top-3 left-7 rounded-full bg-foreground text-background text-[10px] font-semibold px-3 py-1 tracking-wider uppercase">
          {t("recommended")}
        </span>
      )}
      <div className="font-medium text-lg">{t(`plan_${planId}_name`)}</div>
      <p className="text-sm text-muted-foreground mt-1">
        {t(`plan_${planId}_tagline`)}
      </p>
      <div className="mt-4 flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold tracking-tight num-display">
          {price}
        </span>
        <span className="text-sm text-muted-foreground">
          / {t("per_month")}
        </span>
      </div>
      <ul className="mt-6 space-y-2.5 text-sm text-muted-foreground">
        <li className="flex items-start gap-2">
          <Check className="h-4 w-4 text-success shrink-0 mt-0.5" aria-hidden />
          {t(`plan_${planId}_engagements`)}
        </li>
        <li className="flex items-start gap-2">
          <Check className="h-4 w-4 text-success shrink-0 mt-0.5" aria-hidden />
          {t(`plan_${planId}_users`)}
        </li>
        <li className="flex items-start gap-2">
          <Check className="h-4 w-4 text-success shrink-0 mt-0.5" aria-hidden />
          {t(`plan_${planId}_features`)}
        </li>
      </ul>
    </Link>
  );
}

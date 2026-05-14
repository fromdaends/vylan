import Image from "next/image";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { PLANS, PAID_PLANS, type PlanId } from "@/lib/plans";
import { formatCurrency } from "@/lib/format";
import { assertLocale } from "@/lib/locale";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { PublicFooter } from "@/components/public/public-footer";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Logo } from "@/components/brand/logo";
import { Reveal } from "@/components/public/reveal";

// Landing page. Server Component, content-first, minimalist redesign
// per docs/design-system.md (Stripe + Linear reference). All motion
// goes through the <Reveal> client wrapper which uses
// IntersectionObserver and respects prefers-reduced-motion.

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
    <main className="relative flex-1 flex flex-col bg-background text-foreground">
      <Header locale={locale} otherLocale={otherLocale} t={t} tAuth={tAuth} />
      <Hero t={t} tAuth={tAuth} />
      <ProductPreview />
      <HowItWorks t={t} />
      <AiChecks t={t} />
      <Benefits t={t} />
      <PricingPreview t={t} tPricing={tPricing} locale={locale} />
      <FinalCta t={t} tAuth={tAuth} />
      <PublicFooter />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────

function Header({
  locale,
  otherLocale,
  t,
  tAuth,
}: {
  locale: "fr" | "en";
  otherLocale: "fr" | "en";
  t: Awaited<ReturnType<typeof getTranslations<"Landing">>>;
  tAuth: Awaited<ReturnType<typeof getTranslations<"Auth">>>;
}) {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-background/80 border-b border-border/60">
      <div className="mx-auto max-w-6xl flex items-center justify-between px-6 h-14">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold tracking-tight text-base"
          aria-label={brand.name}
        >
          <Logo size={28} priority />
          <span>{brand.name}</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/pricing" className="hidden sm:inline-flex">
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
          <Link href="/login" className="hidden sm:inline-flex">
            <Button variant="ghost" size="sm">
              {tAuth("sign_in")}
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">{tAuth("create_account")}</Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Hero
// ─────────────────────────────────────────────────────────────────────

function Hero({
  t,
  tAuth,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Landing">>>;
  tAuth: Awaited<ReturnType<typeof getTranslations<"Auth">>>;
}) {
  return (
    <section className="relative">
      <div className="mx-auto max-w-3xl px-6 pt-24 pb-20 sm:pt-32 sm:pb-24 text-center">
        <Reveal>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
            <span>{t("intro_eyebrow")}</span>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <h1 className="mt-8 text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] text-foreground">
            {t("headline")}
          </h1>
        </Reveal>
        <Reveal delay={160}>
          <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {t("subhead")}
          </p>
        </Reveal>
        <Reveal delay={240}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg" className="h-11 px-5">
                {tAuth("create_account")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
            <Link href="/pricing">
              <Button variant="outline" size="lg" className="h-11 px-5">
                {t("cta_secondary")}
              </Button>
            </Link>
          </div>
        </Reveal>
        <Reveal delay={320}>
          <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-success" aria-hidden />
            {t("trust_no_card")}
            <span aria-hidden className="mx-1.5 text-border">·</span>
            {t("trust_setup")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Product preview screenshot
// ─────────────────────────────────────────────────────────────────────

function ProductPreview() {
  return (
    <section aria-hidden className="relative">
      <div className="mx-auto max-w-6xl px-6 pb-24">
        <Reveal>
          <div className="rounded-xl border border-border bg-card shadow-[0_12px_32px_-8px_rgba(15,18,30,0.08),0_24px_56px_-16px_rgba(15,18,30,0.06)] overflow-hidden">
            <Image
              src="/landing/screenshot-dashboard.svg"
              alt=""
              width={1280}
              height={800}
              priority={false}
              className="w-full h-auto block"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// How it works — 3 numbered steps
// ─────────────────────────────────────────────────────────────────────

function HowItWorks({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Landing">>>;
}) {
  const steps = [
    { n: 1, title: t("step_1_title"), body: t("step_1_body") },
    { n: 2, title: t("step_2_title"), body: t("step_2_body") },
    { n: 3, title: t("step_3_title"), body: t("step_3_body") },
  ];
  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <Reveal>
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.08em] font-medium text-muted-foreground">
              {t("how_eyebrow")}
            </p>
            <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
              {t("how_title")}
            </h2>
          </div>
        </Reveal>
        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 80}>
              <div className="flex flex-col gap-3">
                <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background text-xs font-medium font-mono tabular-nums">
                  {s.n}
                </div>
                <h3 className="text-base font-semibold tracking-tight text-foreground">
                  {s.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {s.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AI document checks — the unique value prop
// ─────────────────────────────────────────────────────────────────────

function AiChecks({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Landing">>>;
}) {
  return (
    <section className="relative border-t border-border/60 bg-secondary/30">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <div className="grid gap-12 md:grid-cols-2 md:items-center">
          <Reveal>
            <div>
              <p className="text-xs uppercase tracking-[0.08em] font-medium text-muted-foreground">
                {t("features_eyebrow")}
              </p>
              <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
                {t("feature_3_title")}
              </h2>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                {t("feature_3_body")}
              </p>
              <ul className="mt-6 space-y-3 text-sm">
                <BulletItem>{t("benefit_3_body")}</BulletItem>
                <BulletItem>{t("intro_pill_2")}</BulletItem>
                <BulletItem>{t("intro_pill_3")}</BulletItem>
              </ul>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <RejectionPreviewCard t={t} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function BulletItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-muted-foreground">
      <Check className="h-4 w-4 mt-0.5 text-accent shrink-0" aria-hidden />
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}

// A small abstract mock of what the client sees when the AI rejects a
// document — gives the section a concrete visual without needing a
// screenshot we'd have to keep updated.
function RejectionPreviewCard({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Landing">>>;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_3px_0_rgba(15,18,30,0.06),0_2px_6px_-2px_rgba(15,18,30,0.04)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">T4 — 2025</p>
        <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive uppercase tracking-wide">
          {t("benefit_3_label")}
        </span>
      </div>
      <div className="mt-3 rounded-md bg-secondary/60 aspect-[4/3]" aria-hidden />
      <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
        <p className="text-xs font-medium text-destructive">
          {t("feature_3_title")}
        </p>
        <p className="mt-1 text-xs text-foreground/80 leading-relaxed">
          {t("feature_3_body")}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Benefits — 3 stat-led cards
// ─────────────────────────────────────────────────────────────────────

function Benefits({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Landing">>>;
}) {
  const items = [
    {
      stat: t("benefit_1_stat"),
      statLabel: t("benefit_1_label"),
      title: t("benefit_1_title"),
      body: t("benefit_1_body"),
    },
    {
      stat: t("benefit_2_stat"),
      statLabel: t("benefit_2_label"),
      title: t("benefit_2_title"),
      body: t("benefit_2_body"),
    },
    {
      stat: t("benefit_3_stat"),
      statLabel: t("benefit_3_label"),
      title: t("benefit_3_title"),
      body: t("benefit_3_body"),
    },
  ];
  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <Reveal>
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.08em] font-medium text-muted-foreground">
              {t("benefits_eyebrow")}
            </p>
            <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
              {t("benefits_title")}
            </h2>
          </div>
        </Reveal>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {items.map((b, i) => (
            <Reveal key={b.title} delay={i * 80}>
              <div className="rounded-xl border border-border bg-card p-6 h-full flex flex-col">
                <div className="font-mono tabular-nums text-3xl font-semibold tracking-tight text-foreground">
                  {b.stat}
                </div>
                <div className="mt-1 text-xs text-muted-foreground uppercase tracking-[0.06em]">
                  {b.statLabel}
                </div>
                <h3 className="mt-6 text-base font-semibold tracking-tight text-foreground">
                  {b.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {b.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Pricing preview
// ─────────────────────────────────────────────────────────────────────

function PricingPreview({
  t,
  tPricing,
  locale,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Landing">>>;
  tPricing: Awaited<ReturnType<typeof getTranslations<"Pricing">>>;
  locale: "fr" | "en";
}) {
  return (
    <section className="relative border-t border-border/60 bg-secondary/30">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <Reveal>
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.08em] font-medium text-muted-foreground">
              {t("pricing_eyebrow")}
            </p>
            <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
              {tPricing("title")}
            </h2>
          </div>
        </Reveal>
        <div className="mt-14 grid gap-6 md:grid-cols-2 max-w-3xl mx-auto">
          {PAID_PLANS.map((id, i) => (
            <Reveal key={id} delay={i * 80}>
              <PlanCard id={id} tPricing={tPricing} locale={locale} />
            </Reveal>
          ))}
        </div>
        <Reveal delay={240}>
          <div className="mt-10 text-center">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-accent transition-colors"
            >
              {t("cta_secondary")}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function PlanCard({
  id,
  tPricing,
  locale,
}: {
  id: PlanId;
  tPricing: Awaited<ReturnType<typeof getTranslations<"Pricing">>>;
  locale: "fr" | "en";
}) {
  const plan = PLANS[id];
  const featured = id === "cabinet";
  return (
    <Link
      href={`/pricing/${id}`}
      className={
        "group block rounded-xl border bg-card p-6 h-full flex flex-col transition-colors " +
        (featured
          ? "border-foreground/30 hover:border-foreground/50"
          : "border-border hover:border-foreground/20")
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight text-foreground">
          {tPricing(`plan_${id}_name` as const)}
        </h3>
        {featured && (
          <span className="rounded-md bg-foreground text-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {tPricing("recommended")}
          </span>
        )}
      </div>
      <div className="mt-4">
        <span className="font-mono tabular-nums text-3xl font-semibold tracking-tight text-foreground">
          {formatCurrency(plan.monthlyCadCents, locale)}
        </span>
        <span className="text-sm text-muted-foreground ml-1">
          {tPricing("per_month")}
        </span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
        {tPricing(`plan_${id}_tagline` as const)}
      </p>
      <div className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-foreground group-hover:text-accent transition-colors">
        {tPricing("plan_cta")}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Final CTA
// ─────────────────────────────────────────────────────────────────────

function FinalCta({
  t,
  tAuth,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Landing">>>;
  tAuth: Awaited<ReturnType<typeof getTranslations<"Auth">>>;
}) {
  return (
    <section className="relative">
      <div className="mx-auto max-w-3xl px-6 py-28 sm:py-36 text-center">
        <Reveal>
          <h2 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.1] text-foreground">
            {t("cta_final_title")}
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            {t("cta_final_body")}
          </p>
        </Reveal>
        <Reveal delay={160}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg" className="h-11 px-5">
                {tAuth("create_account")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </Link>
            <Link href="/pricing">
              <Button variant="ghost" size="lg" className="h-11 px-5">
                {t("cta_secondary")}
              </Button>
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

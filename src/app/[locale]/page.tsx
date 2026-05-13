import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { PLANS, type PlanId } from "@/lib/plans";
import { formatCurrency } from "@/lib/format";
import { assertLocale } from "@/lib/locale";
import { ArrowRight, Check, Sparkles, Zap, Bell, FileCheck } from "lucide-react";
import { PublicFooter } from "@/components/public/public-footer";
import { ThemeToggle } from "@/components/theme/theme-toggle";

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
    <main className="flex-1 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border/60">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-3.5">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight text-base group"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background text-xs font-bold transition-transform group-hover:scale-110 group-hover:rotate-3">
              R
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
        {/* Animated orbs */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 overflow-hidden [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]"
        >
          <div className="orb orb-iris h-[600px] w-[600px] top-[-200px] left-1/2 -translate-x-1/2" />
          <div
            className="orb orb-cyan h-[400px] w-[400px] top-[100px] left-[10%]"
            style={{ animationDelay: "-3s" }}
          />
          <div
            className="orb orb-pink h-[400px] w-[400px] top-[100px] right-[10%]"
            style={{ animationDelay: "-7s" }}
          />
        </div>
        {/* Grid pattern */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_60%)]"
        />

        <div className="mx-auto max-w-4xl px-6 pt-24 pb-24 sm:pt-32 sm:pb-32 text-center animate-in-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 backdrop-blur px-4 py-1.5 text-xs font-medium mb-8">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span className="text-foreground">
              {brand.tagline[locale] ?? t("subhead")}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">v1.0</span>
          </div>
          <h1 className="text-5xl sm:text-7xl md:text-8xl font-semibold tracking-tight leading-[0.95] text-gradient">
            {t("headline")}
          </h1>
          <p className="mt-8 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {t("subhead")}
          </p>
          <div className="mt-12 flex flex-wrap gap-3 justify-center">
            <Link href="/signup">
              <Button size="lg" className="h-12 px-6 text-base glow-accent">
                {t("cta_primary")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/pricing">
              <Button variant="outline" size="lg" className="h-12 px-6 text-base">
                {t("cta_secondary")}
              </Button>
            </Link>
          </div>

          {/* Trust line */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <div className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-success" />
              {t("trust_no_card") || "No credit card required"}
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-success" />
              {t("trust_setup") || "Setup in 2 minutes"}
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-success" />
              {t("trust_cancel") || "Cancel anytime"}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="relative border-t border-border/60">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <div className="text-center mb-16 animate-in-up">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              {t("features_eyebrow") || "Why Relai"}
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {t("features_title") || "Built for small accounting firms"}
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3 animate-in-stagger">
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
      <section className="relative border-t border-border/60 overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-dots opacity-40"
        />
        <div className="mx-auto max-w-5xl px-6 py-24">
          <div className="text-center mb-16 animate-in-up">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              {t("how_eyebrow") || "How it works"}
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {t("how_title")}
            </h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-3 animate-in-stagger">
            <Step n={1} title={t("step_1_title")} body={t("step_1_body")} />
            <Step n={2} title={t("step_2_title")} body={t("step_2_body")} />
            <Step n={3} title={t("step_3_title")} body={t("step_3_body")} />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="relative border-t border-border/60">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <div className="text-center mb-16 animate-in-up">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              {t("pricing_eyebrow") || "Pricing"}
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {tPricing("title")}
            </h2>
            <p className="text-sm text-muted-foreground mt-4 max-w-md mx-auto">
              {tPricing("subtitle")}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 max-w-4xl mx-auto animate-in-stagger">
            {(["solo", "cabinet", "cabinet_plus"] as PlanId[]).map((planId) => (
              <PlanPreview
                key={planId}
                planId={planId}
                locale={locale}
                featured={planId === "cabinet"}
              />
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link href="/pricing">
              <Button variant="ghost">
                {tPricing("see_all")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative border-t border-border/60 bg-muted/30">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <div className="text-center mb-12 animate-in-up">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
              FAQ
            </div>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {t("faq_title")}
            </h2>
          </div>
          <dl className="space-y-2 animate-in-stagger">
            <Faq q={t("faq_1_q")} a={t("faq_1_a")} />
            <Faq q={t("faq_2_q")} a={t("faq_2_a")} />
            <Faq q={t("faq_3_q")} a={t("faq_3_a")} />
            <Faq q={t("faq_4_q")} a={t("faq_4_a")} />
          </dl>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative border-t border-border/60 overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="orb orb-iris h-[500px] w-[500px] top-[20%] left-1/2 -translate-x-1/2" />
        </div>
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight text-gradient">
            {t("cta_final_title") || t("headline")}
          </h2>
          <p className="mt-6 text-base text-muted-foreground max-w-xl mx-auto">
            {t("cta_final_body") || t("subhead")}
          </p>
          <div className="mt-10 flex flex-wrap gap-3 justify-center">
            <Link href="/signup">
              <Button size="lg" className="h-12 px-6 text-base glow-accent">
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
    <div className="group relative rounded-2xl border border-border bg-card p-6 hover-lift hover:border-foreground/20 hover:shadow-lg transition-all">
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
    <div className="relative">
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl border border-border bg-card font-mono text-lg font-medium text-foreground mb-5 shadow-sm">
        {n}
      </div>
      <div className="font-medium text-lg">{title}</div>
      <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details className="group rounded-xl border border-border bg-card transition-colors hover:border-foreground/20">
      <summary className="flex cursor-pointer items-center justify-between gap-4 p-5 font-medium text-base list-none">
        <span>{q}</span>
        <span
          aria-hidden
          className="text-muted-foreground transition-transform group-open:rotate-45 shrink-0"
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
  return (
    <div
      className={
        "relative rounded-2xl border bg-card p-6 hover-lift transition-all " +
        (featured
          ? "border-transparent ring-conic shadow-xl scale-[1.03] z-10"
          : "border-border hover:border-foreground/20")
      }
    >
      {featured && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground text-background text-[10px] font-semibold px-3 py-1 tracking-wider uppercase shadow-md">
          {t("recommended")}
        </div>
      )}
      <div className="font-medium">{t(`plan_${planId}_name`)}</div>
      <div className="mt-3 flex items-baseline gap-1.5">
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
    </div>
  );
}

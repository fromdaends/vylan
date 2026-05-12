import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { brand } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { PLANS, type PlanId } from "@/lib/plans";
import { formatCurrency } from "@/lib/format";
import { assertLocale } from "@/lib/locale";
import { ArrowRight, Check, Sparkles } from "lucide-react";
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
      <header className="sticky top-0 z-40 backdrop-blur-md bg-background/70 border-b border-border/60">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-3.5">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold tracking-tight text-base"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background text-[10px] font-bold">
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

      {/* Hero */}
      <section className="relative overflow-hidden">
        {/* Subtle gradient backdrop */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,oklch(0.62_0.18_264/.08),transparent_60%)] dark:bg-[radial-gradient(circle_at_top,oklch(0.7_0.16_264/.12),transparent_60%)]" />
        </div>

        <div className="mx-auto max-w-3xl px-6 pt-24 pb-20 sm:pt-32 sm:pb-28 animate-in-up">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 backdrop-blur px-3 py-1 text-xs text-muted-foreground mb-6">
            <Sparkles className="h-3 w-3 text-accent" />
            <span>{brand.tagline[locale] ?? t("subhead")}</span>
          </div>
          <h1 className="text-5xl sm:text-6xl font-semibold tracking-tight leading-[1.05] text-gradient">
            {t("headline")}
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl leading-relaxed">
            {t("subhead")}
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/signup">
              <Button size="lg">
                {t("cta_primary")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/pricing">
              <Button variant="outline" size="lg">
                {t("cta_secondary")}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <div className="grid gap-12 sm:grid-cols-3 animate-in-stagger">
            <Feature title={t("feature_1_title")} body={t("feature_1_body")} />
            <Feature title={t("feature_2_title")} body={t("feature_2_body")} />
            <Feature title={t("feature_3_title")} body={t("feature_3_body")} />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-border/60 bg-muted/30">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <h2 className="text-3xl font-semibold tracking-tight text-center mb-16">
            {t("how_title")}
          </h2>
          <div className="grid gap-12 sm:grid-cols-3 animate-in-stagger">
            <Step n={1} title={t("step_1_title")} body={t("step_1_body")} />
            <Step n={2} title={t("step_2_title")} body={t("step_2_body")} />
            <Step n={3} title={t("step_3_title")} body={t("step_3_body")} />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <h2 className="text-3xl font-semibold tracking-tight text-center">
            {tPricing("title")}
          </h2>
          <p className="text-sm text-muted-foreground text-center mt-3">
            {tPricing("subtitle")}
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-3 max-w-4xl mx-auto animate-in-stagger">
            {(["solo", "cabinet", "cabinet_plus"] as PlanId[]).map((planId) => (
              <PlanPreview
                key={planId}
                planId={planId}
                locale={locale}
                featured={planId === "cabinet"}
              />
            ))}
          </div>
          <div className="mt-10 text-center">
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
      <section className="border-t border-border/60 bg-muted/30">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <h2 className="text-3xl font-semibold tracking-tight text-center mb-12">
            {t("faq_title")}
          </h2>
          <dl className="space-y-8 animate-in-stagger">
            <Faq q={t("faq_1_q")} a={t("faq_1_a")} />
            <Faq q={t("faq_2_q")} a={t("faq_2_a")} />
            <Faq q={t("faq_3_q")} a={t("faq_3_a")} />
            <Faq q={t("faq_4_q")} a={t("faq_4_a")} />
          </dl>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="group">
      <div className="font-medium text-base mb-2 transition-colors group-hover:text-accent">
        {title}
      </div>
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
    <div>
      <div className="inline-flex items-center justify-center h-7 w-7 rounded-full border border-border bg-card font-mono text-xs text-muted-foreground mb-4">
        {n}
      </div>
      <div className="font-medium text-base">{title}</div>
      <p className="text-muted-foreground text-sm mt-2 leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <dt className="font-medium text-base">{q}</dt>
      <dd className="text-sm text-muted-foreground mt-2 leading-relaxed">
        {a}
      </dd>
    </div>
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
        "relative rounded-xl border bg-card p-6 hover-lift " +
        (featured
          ? "border-accent/40 ring-1 ring-accent/20 shadow-sm"
          : "border-border")
      }
    >
      {featured && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-accent text-accent-foreground text-[10px] font-medium px-2.5 py-0.5 tracking-wide uppercase">
          {t("recommended")}
        </div>
      )}
      <div className="font-medium">{t(`plan_${planId}_name`)}</div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tracking-tight">{price}</span>
        <span className="text-sm text-muted-foreground">
          / {t("per_month")}
        </span>
      </div>
      <ul className="mt-5 space-y-2 text-xs text-muted-foreground">
        <li className="flex items-start gap-2">
          <Check className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" aria-hidden />
          {t(`plan_${planId}_engagements`)}
        </li>
        <li className="flex items-start gap-2">
          <Check className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" aria-hidden />
          {t(`plan_${planId}_users`)}
        </li>
        <li className="flex items-start gap-2">
          <Check className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" aria-hidden />
          {t(`plan_${planId}_features`)}
        </li>
      </ul>
    </div>
  );
}

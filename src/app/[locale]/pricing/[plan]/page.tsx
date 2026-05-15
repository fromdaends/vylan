import { setRequestLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { PLANS, PAID_PLANS, type PlanId } from "@/lib/plans";
import { formatCurrency } from "@/lib/format";
import { assertLocale } from "@/lib/locale";
import { ArrowRight, Check } from "lucide-react";
import { PublicNav } from "@/components/public/public-nav";
import { PublicFooter } from "@/components/public/public-footer";

function isPaidPlanId(value: string): value is Extract<PlanId, "solo" | "cabinet"> {
  return (PAID_PLANS as string[]).includes(value);
}

export default async function PlanPage({
  params,
}: {
  params: Promise<{ locale: string; plan: string }>;
}) {
  const { locale: rawLocale, plan } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  if (!isPaidPlanId(plan)) {
    notFound();
  }

  const t = await getTranslations("Pricing");
  const tLanding = await getTranslations("Landing");

  const planCfg = PLANS[plan];
  const price =
    planCfg.monthlyCadCents != null
      ? formatCurrency(planCfg.monthlyCadCents / 100, locale, 0)
      : "—";
  const featured = plan === "cabinet";

  return (
    <main className="flex-1 flex flex-col pt-24">
      <PublicNav />

      <section className="mx-auto w-full max-w-3xl px-6 py-20">
        <div className="text-center">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
            {t("title")}
          </div>
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
            {t(`plan_${plan}_name`)}
          </h1>
          <p className="mt-3 text-base text-muted-foreground max-w-xl mx-auto">
            {t(`plan_${plan}_tagline`)}
          </p>
        </div>

        <div
          className={
            "mt-12 rounded-2xl border bg-card p-8 sm:p-10 " +
            (featured
              ? "featured-card border-transparent"
              : "border-border")
          }
        >
          {featured && (
            <span className="inline-block rounded-full bg-foreground text-background text-[10px] font-semibold px-3 py-1 tracking-wider uppercase mb-5">
              {t("recommended")}
            </span>
          )}
          <div className="flex items-baseline gap-2">
            <span className="text-6xl font-semibold tracking-tight num-display">
              {price}
            </span>
            <span className="text-base text-muted-foreground">
              / {t("per_month")}
            </span>
          </div>

          <ul className="mt-8 space-y-3 text-base">
            <li className="flex items-start gap-2.5">
              <Check className="size-5 text-success shrink-0 mt-0.5" aria-hidden />
              <span>{t(`plan_${plan}_engagements`)}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="size-5 text-success shrink-0 mt-0.5" aria-hidden />
              <span>{t(`plan_${plan}_users`)}</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Check className="size-5 text-success shrink-0 mt-0.5" aria-hidden />
              <span>{t(`plan_${plan}_features`)}</span>
            </li>
          </ul>

          {/* /signup?plan=<id> — the plan param will hook into Stripe
              checkout once that flow is wired; for now it just carries
              the user's intent into the signup form. */}
          <Link href={`/signup?plan=${plan}`} className="block mt-10">
            <Button size="lg" className="w-full press h-12 text-base">
              {tLanding("cta_primary")}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            {t("trial_note")}
          </p>
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          {t("currency_note")}
        </p>
      </section>

      <PublicFooter />
    </main>
  );
}

export async function generateStaticParams() {
  return PAID_PLANS.map((plan) => ({ plan }));
}

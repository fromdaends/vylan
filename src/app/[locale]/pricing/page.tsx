import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { brand } from "@/lib/brand";
import { PLANS, PAID_PLANS, type PlanId } from "@/lib/plans";
import { formatCurrency } from "@/lib/format";
import { assertLocale } from "@/lib/locale";
import { Check } from "lucide-react";
import { PublicFooter } from "@/components/public/public-footer";

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("Pricing");
  const tAuth = await getTranslations("Auth");

  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight text-lg">
            {brand.name}
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link href="/signup">
              <Button size="sm">{tAuth("create_account")}</Button>
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-20">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-center">
          {t("title")}
        </h1>
        <p className="mt-3 text-center text-muted-foreground max-w-2xl mx-auto">
          {t("subtitle_long")}
        </p>

        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {PAID_PLANS.map((planId) => (
            <PlanCard key={planId} planId={planId} locale={locale} />
          ))}
        </div>

        <div className="mt-12 max-w-2xl mx-auto text-sm text-muted-foreground space-y-3 text-center">
          <p>{t("trial_note")}</p>
          <p>{t("currency_note")}</p>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

async function PlanCard({
  planId,
  locale,
}: {
  planId: PlanId;
  locale: "fr" | "en";
}) {
  const t = await getTranslations("Pricing");
  const tAuth = await getTranslations("Auth");
  const plan = PLANS[planId];
  const price =
    plan.monthlyCadCents != null
      ? formatCurrency(plan.monthlyCadCents / 100, locale, 0)
      : "—";
  const featured = planId === "cabinet";

  return (
    <Link
      href={`/pricing/${planId}`}
      className={
        "relative block cursor-pointer rounded-2xl border bg-card p-7 flex flex-col gap-5 tilt no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
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
      <div>
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
      </div>
      <ul className="text-sm space-y-2.5 text-muted-foreground">
        <li className="flex items-start gap-2">
          <Check className="size-4 text-success shrink-0 mt-0.5" aria-hidden />
          {t(`plan_${planId}_engagements`)}
        </li>
        <li className="flex items-start gap-2">
          <Check className="size-4 text-success shrink-0 mt-0.5" aria-hidden />
          {t(`plan_${planId}_users`)}
        </li>
        <li className="flex items-start gap-2">
          <Check className="size-4 text-success shrink-0 mt-0.5" aria-hidden />
          {t(`plan_${planId}_features`)}
        </li>
      </ul>
      <div
        className={
          "mt-auto inline-flex items-center justify-center rounded-md text-sm font-medium px-4 py-2 transition-colors " +
          (featured
            ? "bg-primary text-primary-foreground"
            : "border border-border text-foreground")
        }
      >
        {tAuth("create_account")}
      </div>
    </Link>
  );
}

import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { brand } from "@/lib/brand";
import { PLANS, type PlanId } from "@/lib/plans";
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

      <section className="mx-auto max-w-5xl px-6 py-20">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-center">
          {t("title")}
        </h1>
        <p className="mt-3 text-center text-muted-foreground max-w-2xl mx-auto">
          {t("subtitle_long")}
        </p>

        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {(["solo", "cabinet", "cabinet_plus"] as PlanId[]).map((planId) => (
            <PlanCard key={planId} planId={planId} locale={locale} />
          ))}
        </div>

        <div className="mt-12 max-w-2xl mx-auto text-sm text-muted-foreground space-y-3">
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
  const isMid = planId === "cabinet"; // Highlight the recommended one

  return (
    <div
      className={
        "rounded-xl border bg-card p-6 flex flex-col gap-4 " +
        (isMid ? "border-primary shadow-sm" : "border-border")
      }
    >
      <div>
        <div className="flex items-center gap-2">
          <div className="font-medium">{t(`plan_${planId}_name`)}</div>
          {isMid && (
            <span className="text-xs bg-primary text-primary-foreground rounded-full px-2 py-0.5">
              {t("recommended")}
            </span>
          )}
        </div>
        <div className="mt-2 text-3xl font-semibold tracking-tight">
          {price}
          <span className="text-sm text-muted-foreground font-normal">
            {" "}
            / {t("per_month")}
          </span>
        </div>
      </div>
      <ul className="text-sm space-y-2 text-muted-foreground">
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
      <Link href="/signup" className="mt-auto">
        <Button className="w-full" variant={isMid ? "default" : "outline"}>
          {tAuth("create_account")}
        </Button>
      </Link>
    </div>
  );
}

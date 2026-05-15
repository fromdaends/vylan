import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PLANS, type PlanId } from "@/lib/plans";
import { formatCurrency } from "@/lib/format";
import { Check, Sparkles } from "lucide-react";

// Pricing plan card. Used on /pricing (and previously inline on the
// landing). Whole card is a link to /pricing/<id>; the featured plan
// gets the iris-glow `.featured-card` treatment.

export async function PlanPreview({
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
    <Link
      href={`/pricing/${planId}`}
      className={
        "relative block cursor-pointer rounded-2xl border bg-card p-7 tilt no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
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
        <li className="flex items-start gap-2 text-foreground font-medium">
          <Sparkles className="h-4 w-4 text-accent shrink-0 mt-0.5" aria-hidden />
          {t("trial_feature")}
        </li>
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

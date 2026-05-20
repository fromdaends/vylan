import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getFirmLimits } from "@/lib/plan-limits";
import { PLANS, PAID_PLANS, priceIdFor, type PlanId } from "@/lib/plans";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { PortalButton } from "@/components/billing/portal-button";
import { isStripeConfigured } from "@/lib/stripe";
import { assertLocale } from "@/lib/locale";
import { formatCurrency, formatDate } from "@/lib/format";
import { BILLING_ENABLED } from "@/lib/billing-mode";
import { Calendar, Mail } from "lucide-react";
import { BookCallButton } from "@/components/booking/book-call-button";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);
  const sp = await searchParams;

  const [firm, limits] = await Promise.all([
    getCurrentFirm(),
    getFirmLimits(),
  ]);
  const t = await getTranslations("Billing");

  const stripeConfigured = isStripeConfigured();

  // Billing is off while we sell our first clients 1-on-1 with
  // custom pricing. Render a contact-us placeholder; the real plan
  // picker + Stripe checkout come back when BILLING_ENABLED flips
  // to true. We intentionally do NOT short-circuit the data fetches
  // above so the page still loads quickly when billing returns.
  if (!BILLING_ENABLED) {
    return (
      <div className="space-y-6 max-w-2xl">
        <header className="animate-in-up">
          <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("placeholder_subtitle")}
          </p>
        </header>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-muted-foreground shrink-0">
                <Calendar className="h-5 w-5" />
              </span>
              <div className="space-y-3">
                <h2 className="text-base font-medium">
                  {t("placeholder_heading")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("placeholder_body")}
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <BookCallButton
                    label={t("placeholder_book_cta")}
                    icon={<Calendar className="h-4 w-4" />}
                  />
                  <a
                    href="mailto:hello@relai.app?subject=Pricing%20chat"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {t("placeholder_email_link")}
                  </a>
                </div>
                <p className="text-xs text-muted-foreground/80">
                  {t("response_time")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl">
      <header className="animate-in-up">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("subtitle")}</p>
      </header>

      {sp.status === "success" && (
        <Alert>
          <AlertDescription>{t("checkout_success")}</AlertDescription>
        </Alert>
      )}
      {sp.status === "cancelled" && (
        <Alert variant="destructive">
          <AlertDescription>{t("checkout_cancelled")}</AlertDescription>
        </Alert>
      )}
      {!stripeConfigured && (
        <Alert>
          <AlertDescription>{t("stripe_not_configured")}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("current_plan")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge>{firm?.plan?.toUpperCase()}</Badge>
            {limits && limits.maxActiveEngagements != null && (
              <span className="text-sm text-muted-foreground">
                {t("usage", {
                  used: limits.activeEngagements,
                  cap: limits.maxActiveEngagements,
                })}
              </span>
            )}
          </div>

          {firm?.plan === "trial" && limits?.trialEndsAt && (
            <p className="text-sm text-muted-foreground">
              {limits.trialExpired
                ? t("trial_expired")
                : t("trial_ends", {
                    date: formatDate(limits.trialEndsAt, locale, "medium"),
                  })}
            </p>
          )}

          {firm?.stripe_customer_id && (
            <PortalButton label={t("manage")} />
          )}
        </CardContent>
      </Card>

      <section>
        <h2 className="text-base font-medium mb-3">{t("plans_title")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PAID_PLANS.map((planId) => (
            <PlanCard
              key={planId}
              planId={planId}
              currentPlan={firm?.plan as PlanId | undefined}
              locale={locale}
              priceConfigured={Boolean(priceIdFor(planId))}
              stripeConfigured={stripeConfigured}
            />
          ))}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        {t("billing_note")}
      </p>
    </div>
  );
}

async function PlanCard({
  planId,
  currentPlan,
  locale,
  priceConfigured,
  stripeConfigured,
}: {
  planId: PlanId;
  currentPlan: PlanId | undefined;
  locale: "fr" | "en";
  priceConfigured: boolean;
  stripeConfigured: boolean;
}) {
  const t = await getTranslations("Billing");
  const plan = PLANS[planId];
  const isCurrent = currentPlan === planId;
  const monthlyDisplay =
    plan.monthlyCadCents != null
      ? formatCurrency(plan.monthlyCadCents / 100, locale, 0)
      : "—";

  return (
    <Card
      className={isCurrent ? "border-primary" : undefined}
      aria-label={t(`plan_${planId}_name`)}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {t(`plan_${planId}_name`)}
          </CardTitle>
          {isCurrent && <Badge variant="secondary">{t("current")}</Badge>}
        </div>
        <p className="text-2xl font-semibold tracking-tight">
          {monthlyDisplay}
          <span className="text-sm text-muted-foreground font-normal">
            {" "}
            / {t("per_month")}
          </span>
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="text-sm space-y-1 text-muted-foreground">
          <li>{t(`plan_${planId}_engagements`)}</li>
          <li>{t(`plan_${planId}_users`)}</li>
          <li>{t(`plan_${planId}_features`)}</li>
        </ul>
        {!isCurrent && (
          <CheckoutButton
            planId={planId}
            disabled={!stripeConfigured || !priceConfigured}
            disabledLabel={
              !stripeConfigured
                ? t("disabled_stripe")
                : t("disabled_price")
            }
            label={t("subscribe")}
          />
        )}
      </CardContent>
    </Card>
  );
}

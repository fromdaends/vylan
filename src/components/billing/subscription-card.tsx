import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { PortalButton } from "@/components/billing/portal-button";
import { formatDate } from "@/lib/format";

// Subscription summary card. Shows the plan tier, subscription status,
// and next-billing date if the firm has an active Stripe subscription.
// The "Manage subscription" button only renders when we have a Stripe
// customer ID on file — for firms still on trial (no Stripe customer
// yet) we just show the trial state.
//
// Used on /profile (owner-only). Used to live on /settings — moved to
// /profile because subscription belongs with "you / your account"
// rather than "app preferences".
export async function SubscriptionCard({
  plan,
  subscriptionStatus,
  currentPeriodEnd,
  stripeCustomerId,
  locale,
}: {
  plan: string;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  locale: "fr" | "en";
}) {
  const t = await getTranslations("Settings");
  const statusLabel = (() => {
    if (!subscriptionStatus) return t("sub_status_none");
    switch (subscriptionStatus) {
      case "active":
        return t("sub_status_active");
      case "trialing":
        return t("sub_status_trialing");
      case "past_due":
        return t("sub_status_past_due");
      case "canceled":
      case "incomplete_expired":
        return t("sub_status_canceled");
      case "incomplete":
      case "unpaid":
        return t("sub_status_incomplete");
      case "paused":
        return t("sub_status_paused");
      default:
        return subscriptionStatus;
    }
  })();
  const isActive =
    subscriptionStatus === "active" || subscriptionStatus === "trialing";
  const planLabel = (() => {
    switch (plan) {
      case "trial":
        return t("plan_label_trial");
      case "solo":
        return t("plan_label_solo");
      case "cabinet":
        return t("plan_label_cabinet");
      case "cabinet_plus":
        return t("plan_label_cabinet_plus");
      default:
        return plan;
    }
  })();
  return (
    <section>
      <h2 className="text-sm font-semibold">{t("section_subscription")}</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {t("section_subscription_hint")}
      </p>
      <div className="mt-4 rounded-lg border border-border bg-card p-4 max-w-xl space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge variant={isActive ? "default" : "secondary"}>
              {planLabel}
            </Badge>
            <span className="text-xs text-muted-foreground">
              · {statusLabel}
            </span>
          </div>
          {stripeCustomerId && <PortalButton label={t("sub_manage")} />}
        </div>
        {currentPeriodEnd && isActive && (
          <div className="text-sm">
            <span className="text-muted-foreground">
              {subscriptionStatus === "trialing"
                ? t("sub_trial_ends_label")
                : t("sub_next_billing_label")}
            </span>{" "}
            <span className="font-medium">
              {formatDate(currentPeriodEnd, locale, "medium")}
            </span>
          </div>
        )}
        {!stripeCustomerId && plan === "trial" && (
          <p className="text-xs text-muted-foreground">
            {t("sub_no_subscription_hint")}
          </p>
        )}
      </div>
    </section>
  );
}

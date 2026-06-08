import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { isTrialExpired, trialDaysLeft } from "@/lib/trial";
import { getFirmAiUsage } from "@/lib/ai/usage";
import { getBrandingImageUrl } from "@/lib/storage";
import { assertLocale } from "@/lib/locale";
import { SettingsShell } from "./settings-form";
import { TrialStatusCard } from "@/components/app/trial-status-card";
import { SubscriptionCard } from "@/components/billing/subscription-card";

export const dynamic = "force-dynamic";

// /settings: a sectioned settings surface (sub-nav on the left, the selected
// category on the right). Categories: Account (email + password sign-in +
// firm settings), Security & privacy (two-factor for everyone, plus the
// owner-only audit log / export / delete tools), Appearance (mode), General
// (language + timezone), Billing (subscription, owner-only), Documents
// (auto-reject). ?tab=<section> deep-links a category (used by the avatar
// menu + the old /firm redirect).
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const { tab } = await searchParams;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(getPathname({ locale, href: "/login" }));
  }
  const [user, firm, mfaFactors] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (!user || !firm) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  const firmLogoUrl = await getBrandingImageUrl(firm.logo_url);
  // AI monthly-cap usage for the Documents tab status (point-read; resilient
  // pre-migration — defaults to 0 used / not paused).
  const aiUsage = await getFirmAiUsage(firm.id);
  // MFA is "enabled" only with a verified TOTP factor (unverified = mid-enroll).
  const mfaEnabled = (mfaFactors.data?.totp ?? []).some(
    (f) => f.status === "verified",
  );

  const t = await getTranslations("Settings");
  const isOwner = user.role === "owner";

  // Free-trial status card state (owner-only, unconverted trial firms).
  // The helpers default "now" internally (keeps Date.now() out of render).
  const trialExpired = isTrialExpired(firm);
  const trialDays = trialDaysLeft(firm);

  // The subscription summary is an async server component; render it here and
  // hand it to the (client) settings shell as a slot for the Billing tab.
  const billingSlot = isOwner ? (
    <SubscriptionCard
      plan={firm.plan}
      subscriptionStatus={firm.subscription_status}
      currentPeriodEnd={firm.current_period_end}
      stripeCustomerId={firm.stripe_customer_id}
      locale={locale}
    />
  ) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in-up">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("subtitle")}</p>
      </header>

      {/* Free-trial status — owner-only, only while the firm is an unconverted
          trial. Surfaces days-left + a booking CTA (no free self-upgrade).
          Sits above the sectioned settings so it can't be missed. */}
      {firm.is_demo && user.role === "owner" && (
        <TrialStatusCard expired={trialExpired} daysLeft={trialDays} />
      )}

      <SettingsShell
        currentLocale={user.locale}
        currentTimezone={firm.timezone}
        autoRejectUnusableDocs={firm.auto_reject_unusable_docs}
        aiUsage={aiUsage}
        isOwner={isOwner}
        billingSlot={billingSlot}
        firmName={firm.name}
        firm={{
          name: firm.name,
          brand_color: firm.brand_color,
          locale_default: firm.locale_default,
        }}
        firmLogoUrl={firmLogoUrl}
        email={user.email}
        mfaEnabled={mfaEnabled}
        initialSection={tab}
      />
    </div>
  );
}

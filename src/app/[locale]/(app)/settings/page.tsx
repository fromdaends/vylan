import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getBrandingImageUrl } from "@/lib/storage";
import { assertLocale } from "@/lib/locale";
import { BILLING_ENABLED } from "@/lib/billing-mode";
import { SettingsShell } from "./settings-form";
import { GoLiveCard } from "@/components/settings/go-live-card";

export const dynamic = "force-dynamic";

// /settings: a sectioned settings surface (sub-nav on the left, the selected
// category on the right). Categories: Account (firm settings + email +
// password + two-factor), Appearance (mode), General (language + timezone),
// Documents (auto-reject), and an owner-only Data & privacy bucket.
// ?tab=<section> deep-links a category (used by the avatar menu + the old
// /firm redirect).
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
  // MFA is "enabled" only with a verified TOTP factor (unverified = mid-enroll).
  const mfaEnabled = (mfaFactors.data?.totp ?? []).some(
    (f) => f.status === "verified",
  );

  const t = await getTranslations("Settings");

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in-up">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("subtitle")}</p>
      </header>

      {/* Go-live promotion — owner-only, only while the firm is still a demo.
          Sits above the sectioned settings so it can't be missed. */}
      {firm.is_demo && user.role === "owner" && <GoLiveCard />}

      <SettingsShell
        currentLocale={user.locale}
        currentTimezone={firm.timezone}
        autoRejectUnusableDocs={firm.auto_reject_unusable_docs}
        isOwner={user.role === "owner"}
        billingEnabled={BILLING_ENABLED}
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

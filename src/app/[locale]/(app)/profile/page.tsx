import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getBrandingImageUrl } from "@/lib/storage";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(getPathname({ locale, href: "/login" }));
  }

  // Fan out everything this page needs. getCurrentUser / getCurrentFirm
  // are React.cache()-wrapped — the (app) layout already called them
  // and the cache returns the same result instantly here.
  const [user, firm, mfaFactors, t] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    supabase.auth.mfa.listFactors(),
    getTranslations("Profile"),
  ]);
  if (!user || !firm) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  // Branding URLs can fan out alongside each other, but they need the
  // user/firm rows from above to know which paths to sign.
  const [avatarUrl, firmLogoUrl] = await Promise.all([
    getBrandingImageUrl(user.avatar_path),
    getBrandingImageUrl(firm.logo_url),
  ]);
  // A user has MFA "enabled" only when they have a verified TOTP factor.
  // Unverified factors are mid-enrollment leftovers and don't count.
  const mfaEnabled = (mfaFactors.data?.totp ?? []).some(
    (f) => f.status === "verified",
  );

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in-up">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">{t("subtitle")}</p>
      </header>

      <ProfileForm
        user={{
          id: user.id,
          email: user.email,
          name: user.name,
          display_name: user.display_name,
        }}
        displayLabel={userDisplayLabel(user)}
        firm={{
          name: firm.name,
          brand_color: firm.brand_color,
          timezone: firm.timezone,
          locale_default: firm.locale_default,
        }}
        avatarUrl={avatarUrl}
        firmLogoUrl={firmLogoUrl}
        mfaEnabled={mfaEnabled}
      />
    </div>
  );
}

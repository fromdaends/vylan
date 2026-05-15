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

  const [user, firm] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
  ]);
  if (!user || !firm) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  const [avatarUrl, firmLogoUrl] = await Promise.all([
    getBrandingImageUrl(user.avatar_path),
    getBrandingImageUrl(firm.logo_url),
  ]);
  const t = await getTranslations("Profile");

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
      />
    </div>
  );
}

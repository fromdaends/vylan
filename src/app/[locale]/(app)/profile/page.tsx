import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { getBrandingImageUrl } from "@/lib/storage";
import { getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { ProfileForm } from "./profile-form";
import { Breadcrumb } from "@/components/ui/breadcrumb";

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
  // and the cache returns the same result instantly here. We still need
  // the firm row for the brand color used to tint the avatar fallback.
  // Email / password / two-factor live in Settings → Security; the
  // subscription summary lives in Settings → Billing.
  const [user, firm, t] = await Promise.all([
    getCurrentUser(),
    getCurrentFirm(),
    getTranslations("Profile"),
  ]);
  if (!user || !firm) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  const avatarUrl = await getBrandingImageUrl(user.avatar_path);
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in-up">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_settings"), href: "/settings" },
          { label: t("title") },
        ]}
      />
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          {t("subtitle_v2")}
        </p>
      </header>

      <ProfileForm
        user={{
          id: user.id,
          email: user.email,
          name: user.name,
          display_name: user.display_name,
        }}
        displayLabel={userDisplayLabel(user)}
        brandColor={firm.brand_color}
        avatarUrl={avatarUrl}
      />
    </div>
  );
}

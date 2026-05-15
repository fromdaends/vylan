import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { getBrandingImageUrl } from "@/lib/storage";
import { getTranslations } from "next-intl/server";
import { HelpSidebar } from "@/components/help/help-sidebar";
import { KeyboardShortcuts } from "@/components/help/keyboard-shortcuts";
import { AppShell } from "@/components/app/app-shell";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await getServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(getPathname({ locale, href: "/login" }));
  }

  const dbUser = await getCurrentUser();
  const firm = await getCurrentFirm();

  if (!dbUser || !firm || !firm.onboarded_at) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  const t = await getTranslations("App");
  const tAuth = await getTranslations("Auth");
  const tProfile = await getTranslations("Profile");

  const [avatarUrl, firmLogoUrl] = await Promise.all([
    getBrandingImageUrl(dbUser.avatar_path),
    getBrandingImageUrl(firm.logo_url),
  ]);

  return (
    <AppShell
      firmName={firm.name}
      brandColor={firm.brand_color}
      firmLogoUrl={firmLogoUrl}
      userDisplayName={userDisplayLabel(dbUser)}
      userEmail={dbUser.email}
      userAvatarUrl={avatarUrl}
      labels={{
        dashboard: t("nav_dashboard"),
        clients: t("nav_clients"),
        templates: t("nav_templates"),
        // `nav_billing` translation key kept for the Settings page's
        // billing link card; no longer needed in the top-nav labels.
        settings: t("nav_settings"),
        logout: tAuth("logout"),
        profile: tProfile("menu_profile"),
        help: tProfile("menu_help"),
      }}
    >
      {children}
      <HelpSidebar />
      <KeyboardShortcuts />
    </AppShell>
  );
}

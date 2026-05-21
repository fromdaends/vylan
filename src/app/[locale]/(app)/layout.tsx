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
import { DemoBanner } from "@/components/app/demo-banner";

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

  // Auth is good — fan out everything else this layout needs.
  //
  // MFA gate: if the user enrolled MFA, the session must be at aal2 to
  // access the app. Supabase's getAuthenticatorAssuranceLevel reports
  // currentLevel = aal1 + nextLevel = aal2 in that case.
  //
  // getCurrentUser / getCurrentFirm are React.cache()-wrapped, so the
  // /profile page (which also calls them) reuses these results — no
  // double DB hit on /profile renders.
  const [
    aalResult,
    dbUser,
    firm,
    t,
    tAuth,
    tProfile,
  ] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    getCurrentUser(),
    getCurrentFirm(),
    getTranslations("App"),
    getTranslations("Auth"),
    getTranslations("Profile"),
  ]);

  const aal = aalResult.data;
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(getPathname({ locale, href: "/login/mfa" }));
  }

  if (!dbUser || !firm || !firm.onboarded_at) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

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
      topBar={firm.is_demo ? <DemoBanner /> : undefined}
      labels={{
        dashboard: t("nav_dashboard"),
        clients: t("nav_clients"),
        templates: t("nav_templates"),
        // `nav_billing` translation key kept for the Settings page's
        // billing link card; no longer needed in the sidebar labels.
        settings: t("nav_settings"),
        firm: t("nav_firm"),
        sectionMain: t("nav_section_main"),
        sectionAccount: t("nav_section_account"),
        toggleMenu: t("toggle_menu"),
        collapseSidebar: t("collapse_sidebar"),
        expandSidebar: t("expand_sidebar"),
        account: t("nav_account"),
        logout: tAuth("logout"),
        profile: tProfile("menu_profile"),
        // The "Your firm" tile inside the profile dropdown — labels
        // the firm-context group at the bottom of the menu.
        yourFirm: tProfile("your_firm_label"),
        help: tProfile("menu_help"),
      }}
    >
      {children}
      <HelpSidebar
        locale={locale === "fr" ? "fr" : "en"}
        userDisplayName={userDisplayLabel(dbUser)}
      />
      <KeyboardShortcuts />
    </AppShell>
  );
}

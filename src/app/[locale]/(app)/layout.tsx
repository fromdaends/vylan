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
import { Toaster } from "@/components/ui/sonner";
import { getEngagementBadges } from "@/lib/engagements/badges";

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
    tEng,
  ] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    getCurrentUser(),
    getCurrentFirm(),
    getTranslations("App"),
    getTranslations("Auth"),
    getTranslations("Profile"),
    getTranslations("Engagements"),
  ]);

  const aal = aalResult.data;
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(getPathname({ locale, href: "/login/mfa" }));
  }

  if (!dbUser || !firm || !firm.onboarded_at) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  const [avatarUrl, badges] = await Promise.all([
    getBrandingImageUrl(dbUser.avatar_path),
    getEngagementBadges(),
  ]);

  return (
    <AppShell
      brandColor={firm.brand_color}
      userDisplayName={userDisplayLabel(dbUser)}
      userEmail={dbUser.email}
      userAvatarUrl={avatarUrl}
      topBar={firm.is_demo ? <DemoBanner /> : undefined}
      engagementBadges={{
        ready: badges.readyToReview,
        deleted: badges.recentlyDeleted,
      }}
      labels={{
        inbox: t("nav_inbox"),
        dashboard: t("nav_dashboard"),
        clients: t("nav_clients"),
        engagements: t("nav_engagements"),
        engagementsToggle: t("nav_engagements_toggle"),
        templates: t("nav_templates"),
        engagementViews: {
          active: tEng("view_active_label"),
          ready: tEng("view_ready_label"),
          drafts: tEng("view_drafts_label"),
          completed: tEng("view_completed_label"),
          archived: tEng("view_archived_label"),
          cancelled: tEng("view_cancelled_label"),
          deleted: tEng("view_deleted_label"),
        },
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
        help: tProfile("menu_help"),
      }}
    >
      {children}
      <HelpSidebar
        locale={locale === "fr" ? "fr" : "en"}
        userDisplayName={userDisplayLabel(dbUser)}
      />
      <KeyboardShortcuts />
      <Toaster />
    </AppShell>
  );
}

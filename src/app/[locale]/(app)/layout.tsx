import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { isTrialExpired, trialDaysLeft } from "@/lib/trial";
import { getFirmAiUsage } from "@/lib/ai/usage";
import {
  getCurrentUser,
  listActiveFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { hasActiveTeam } from "@/lib/team/mode";
import { firmHasAnyQuickbooksConnection } from "@/lib/db/quickbooks";
import { getBrandingImageUrl } from "@/lib/storage";
import { getTranslations } from "next-intl/server";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { KeyboardShortcuts } from "@/components/help/keyboard-shortcuts";
import { AppShell } from "@/components/app/app-shell";
import { TrialBanner } from "@/components/app/demo-banner";
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
    activeFirmUsers,
    t,
    tAuth,
    tProfile,
    tEng,
  ] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    getCurrentUser(),
    getCurrentFirm(),
    listActiveFirmUsers(),
    getTranslations("App"),
    getTranslations("Auth"),
    getTranslations("Profile"),
    getTranslations("Engagements"),
  ]);

  const aal = aalResult.data;
  if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    redirect(getPathname({ locale, href: "/login/mfa" }));
  }

  // A deactivated member (removed by the firm owner) is signed out on their
  // next request + bounced to login with a friendly reason. This is the
  // reliable force-logout — deactivateUser only sets the flag.
  if (dbUser?.deactivated_at) {
    await supabase.auth.signOut();
    redirect(getPathname({ locale, href: "/login?error=deactivated" }));
  }

  if (!dbUser || !firm || !firm.onboarded_at) {
    redirect(getPathname({ locale, href: "/onboarding" }));
  }

  const [avatarUrl, firmLogoUrl, badges, quickbooksHasAny] = await Promise.all([
    getBrandingImageUrl(dbUser.avatar_path),
    getBrandingImageUrl(firm.logo_url),
    getEngagementBadges(),
    // Drives the (conditional) QuickBooks nav item. True when the firm has ANY
    // connection (firm-level OR any client) — so the nav appears once QuickBooks
    // is actually in use, not merely because the app's Intuit keys are installed.
    // Cheap + RLS-scoped; false before the migration is applied.
    firmHasAnyQuickbooksConnection(),
  ]);

  // Free-trial banner state (only rendered for unconverted trial firms).
  // isTrialExpired / trialDaysLeft default "now" internally so Date.now()
  // stays out of the render path (react-hooks purity).
  const trialExpired = isTrialExpired(firm);
  const trialDays = trialDaysLeft(firm);
  const teamEnabled = hasActiveTeam({
    teamEnabled: firm.team_enabled === true,
    activeMemberCount: activeFirmUsers.length,
  });
  // Trial firms also hit a hard LIFETIME AI cap (abuse/cost guard) well before
  // the 14 days are up. Surface an "upgrade" state in the banner when it's
  // reached. Only query usage for trial firms — paid firms skip the round trip.
  let aiLimitReached = false;
  if (firm.is_demo) {
    const usage = await getFirmAiUsage(firm.id);
    aiLimitReached = usage.isTrial && usage.paused;
  }

  return (
    <AppShell
      brandColor={firm.brand_color}
      userDisplayName={userDisplayLabel(dbUser)}
      userEmail={dbUser.email}
      userAvatarUrl={avatarUrl}
      firmName={firm.name}
      firmLogoUrl={firmLogoUrl}
      isOwner={dbUser.role === "owner"}
      teamEnabled={teamEnabled}
      quickbooksConnected={quickbooksHasAny}
      topBar={
        firm.is_demo ? (
          <TrialBanner
            expired={trialExpired}
            daysLeft={trialDays}
            aiLimitReached={aiLimitReached}
          />
        ) : undefined
      }
      engagementBadges={{
        ready: badges.readyToReview,
        deleted: badges.recentlyDeleted,
      }}
      labels={{
        dashboard: t("nav_dashboard"),
        clients: t("nav_clients"),
        engagements: t("nav_engagements"),
        engagementsToggle: t("nav_engagements_toggle"),
        templates: t("nav_templates"),
        integrations: t("nav_integrations"),
        integrationsToggle: t("nav_integrations_toggle"),
        engagementViews: {
          active: tEng("view_active_label"),
          ready: tEng("view_ready_label"),
          drafts: tEng("view_drafts_label"),
          completed: tEng("view_completed_label"),
          archived: tEng("view_archived_label"),
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
        helpCenter: tProfile("menu_help_center"),
      }}
    >
      {children}
      <AssistantPanel
        locale={locale === "fr" ? "fr" : "en"}
        userId={dbUser.id}
      />
      <KeyboardShortcuts />
      <Toaster />
    </AppShell>
  );
}

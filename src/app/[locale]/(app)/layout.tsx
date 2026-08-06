import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { getCurrentFirm } from "@/lib/db/firms";
import { isTrialExpired, trialDaysLeft } from "@/lib/trial";
import { getFirmAiUsage } from "@/lib/ai/usage";
import { getCurrentUser, userDisplayLabel } from "@/lib/db/users";
import { firmHasAnyQuickbooksConnection } from "@/lib/db/quickbooks";
import { firmHasAnyXeroConnection } from "@/lib/db/xero";
import { getBrandingImageUrl } from "@/lib/storage";
import { getTranslations } from "next-intl/server";
import { ChatLauncher } from "@/components/assistant/chat-launcher";
import { KeyboardShortcuts } from "@/components/help/keyboard-shortcuts";
import { AppShell } from "@/components/app/app-shell";
import { TrialBanner } from "@/components/app/demo-banner";
import { TimerDock } from "@/components/time/timer-dock";
import { getRunningEntry } from "@/lib/db/time-entries";
import { isTimeInsightsEnabled } from "@/lib/time/flags";
import { can } from "@/lib/auth/capabilities";
import { Toaster } from "@/components/ui/sonner";

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await getServerSupabase();
  // The ONE per-request network auth validation (React.cache'd) —
  // getCurrentUser / getCurrentFirm and the lib/db helpers downstream all
  // reuse it instead of each re-validating against the auth server.
  const authUser = await getAuthUser();
  if (!authUser) {
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
  //
  // The bookkeeping-rail flags ride in the SAME batch: they only need the
  // session, so paying for them after the user/firm resolves (as this layout
  // used to) made every page render one round-trip deeper for no reason.
  const [
    aalResult,
    dbUser,
    firm,
    quickbooksHasAny,
    xeroHasAny,
    t,
    tAuth,
    tProfile,
    tEng,
  ] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    getCurrentUser(),
    getCurrentFirm(),
    // Drives the Bookkeeping rail tab. True when the firm has ANY connection
    // (firm-level OR any client) — so the tab appears once a product is
    // actually in use, not merely because the app's keys are installed.
    // Cheap + RLS-scoped; false before the migration.
    firmHasAnyQuickbooksConnection(),
    firmHasAnyXeroConnection(),
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

  // The firm logo and the engagement ready/deleted badge counts are no longer
  // fetched here: the icon rail has no firm button and no Engagements sub-nav to
  // badge, so both were dead queries on every authenticated page render. The
  // Engagements page still computes its own badges for its tab strip.
  //
  // Trial firms also hit a hard LIFETIME AI cap (abuse/cost guard) well before
  // the 14 days are up. Surface an "upgrade" state in the banner when it's
  // reached. Only query usage for trial firms — paid firms skip the round trip.
  // Batched with the avatar signing rather than awaited after it.
  const timeEnabled = isTimeInsightsEnabled(firm);
  const [avatarUrl, aiUsage, runningEntry] = await Promise.all([
    getBrandingImageUrl(dbUser.avatar_path),
    firm.is_demo ? getFirmAiUsage(firm.id) : Promise.resolve(null),
    // The running-timer pill's one question, asked only when the feature is on
    // — a firm with the flag off pays nothing for it. Errors read as "no
    // timer" inside getRunningEntry, so a broken read can never take the
    // layout down.
    timeEnabled ? getRunningEntry(dbUser.id) : Promise.resolve(null),
  ]);
  const aiLimitReached = aiUsage ? aiUsage.isTrial && aiUsage.paused : false;

  // Free-trial banner state (only rendered for unconverted trial firms).
  // isTrialExpired / trialDaysLeft default "now" internally so Date.now()
  // stays out of the render path (react-hooks purity).
  const trialExpired = isTrialExpired(firm);
  const trialDays = trialDaysLeft(firm);
  return (
    <AppShell
      brandColor={firm.brand_color}
      userDisplayName={userDisplayLabel(dbUser)}
      userEmail={dbUser.email}
      userAvatarUrl={avatarUrl}
      isOwner={dbUser.role === "owner"}
      quickbooksConnected={quickbooksHasAny}
      xeroConnected={xeroHasAny}
      // The CAPABILITY, not the rank (founder: "roles only") — a senior
      // manager granted insights.view through a role gets the tab.
      showInsights={timeEnabled && can(dbUser, "insights.view")}
      topBar={
        // Back to banner-only (timer v2): the timer moved OUT of the top bar
        // and into the dock beside the Chats launcher — one control, bottom
        // right, every screen.
        firm.is_demo ? (
          <TrialBanner
            expired={trialExpired}
            daysLeft={trialDays}
            aiLimitReached={aiLimitReached}
          />
        ) : undefined
      }
      labels={{
        dashboard: t("nav_dashboard"),
        clients: t("nav_clients"),
        engagements: t("nav_engagements"),
        work: t("nav_work"),
        workTasks: t("nav_work_tasks_list"),
        workDashboard: t("nav_work_dashboard"),
        workDashboardHint: t("nav_work_dashboard_hint"),
        workEngagements: t("nav_work_engagements_list"),
        workTasksHint: t("nav_work_tasks_hint"),
        workEngagementsHint: t("nav_engagements_hint"),
        closePanel: t("nav_close_panel"),
        engagementsToggle: t("nav_engagements_toggle"),
        templates: t("nav_templates"),
        files: t("nav_files"),
        // Reuses the existing nav_billing key ("Billing" / "Facturation") —
        // the same word, now pointing at the firm-level Billing section rather
        // than the Vylan subscription page it used to label.
        billing: t("nav_billing"),
        insights: t("nav_insights"),
        workTime: t("nav_work_time"),
        workTimeHint: t("nav_work_time_hint"),
        bookkeeping: t("nav_bookkeeping"),
        vylanHub: t("nav_vylan"),
        engagementViews: {
          active: tEng("view_active_label"),
          all: tEng("view_all_label"),
          ready: tEng("view_ready_label"),
          drafts: tEng("view_drafts_label"),
          completed: tEng("view_completed_label"),
          archived: tEng("view_archived_label"),
          deleted: tEng("view_deleted_label"),
        },
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
      {/* THE one timer control (v2): docked beside the launcher, on every
          screen. Mounted whenever the feature is on so the stop flow's save
          sheet survives the running state ending. */}
      {timeEnabled && (
        <TimerDock
          entry={
            runningEntry
              ? {
                  id: runningEntry.id,
                  startedAt: runningEntry.started_at,
                  clientId: runningEntry.client_id,
                  engagementId: runningEntry.engagement_id,
                  clientName: runningEntry.client_name,
                  engagementTitle: runningEntry.engagement_title,
                  note: runningEntry.note,
                }
              : null
          }
        />
      )}
      <ChatLauncher
        locale={locale === "fr" ? "fr" : "en"}
        userId={dbUser.id}
        // Given name only, for the popup greeting. Deliberately NOT
        // userDisplayLabel(): that falls back to the email local-part, and
        // "Hi philjette77 👋" reads worse than a plain "Hi 👋".
        firstName={
          (dbUser.display_name?.trim() || dbUser.name?.trim() || "").split(
            /\s+/,
          )[0]
        }
      />
      <KeyboardShortcuts />
      <Toaster />
    </AppShell>
  );
}

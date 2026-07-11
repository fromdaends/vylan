import { setRequestLocale } from "next-intl/server";
import { getCurrentUser, listActiveFirmUsers } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { listTemplates, BLANK_TEMPLATE_ID } from "@/lib/db/templates";

export const dynamic = "force-dynamic";
import { assertLocale } from "@/lib/locale";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import { selectAssignedTo } from "@/lib/dashboard/worklist-select";
import { listHomeNotifications } from "@/lib/home/notifications";
import { canDeleteEngagements } from "@/lib/engagements/lifecycle";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import {
  TemplatesGallery,
  type TemplateCard,
} from "@/components/dashboard/templates-gallery";
import { EngagementsWorklist } from "@/components/dashboard/engagements-worklist";
import { OverviewStatsStrip } from "@/components/dashboard/overview-stats-strip";
import { localizedTemplateName } from "@/lib/templates/builtin-names";
import { WhatsNewFeed } from "@/components/inbox/whats-new-feed";
import { WhatsNewBell } from "@/components/inbox/whats-new-bell";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { hasActiveTeam } from "@/lib/team/mode";

// The Overview is the single home that answers all three of an accountant's
// questions: what to do now (stats + Needs attention), what's my work (My
// engagements), and what just happened (What's new — summoned from the
// header bell as a right slide-out, not a permanent rail). One main column;
// Needs attention and the table get the full width the old rail used to take.
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // Resolve the viewer first (React.cache'd, so this is ~free) so What's-new
  // can be scoped per-role: staff see their assigned work; owners see firm-wide.
  const user = await getCurrentUser();
  const viewer = user
    ? { userId: user.id, isOwner: user.role === "owner" }
    : undefined;
  const [worklistRows, firm, activeMembers, templates, notifications] =
    await Promise.all([
      loadEngagementWorklist(),
      getCurrentFirm(),
      listActiveFirmUsers(),
      listTemplates(),
      listHomeNotifications(12, viewer),
    ]);
  const teamEnabled = hasActiveTeam({
    teamEnabled: firm?.team_enabled === true,
    activeMemberCount: activeMembers.length,
  });

  // Needs attention is scoped to a staff member's OWN assigned work (so their
  // Overview is about their work, matching the What's-new feed); owners see the
  // firm-wide queue. The My-engagements table below keeps every row — it has its
  // own Mine/All tabs.
  const attentionRows =
    viewer && !viewer.isOwner
      ? selectAssignedTo(worklistRows, viewer.userId)
      : worklistRows;

  const templateCards: TemplateCard[] = templates
    .filter((tmpl) => tmpl.id !== BLANK_TEMPLATE_ID)
    .map((tmpl) => ({
      id: tmpl.id,
      name: localizedTemplateName(tmpl, locale),
      type: tmpl.type,
      itemCount: tmpl.items.length,
      requiredCount: tmpl.items.filter((it) => it.required).length,
      // First few item labels (localized) for the card's "peek inside".
      preview: tmpl.items
        .slice(0, 3)
        .map((it) => (locale === "fr" ? it.label_fr : it.label_en)),
      builtIn: tmpl.firm_id == null,
    }));

  // First name only — prefer the explicit display_name, fall back to the
  // account name; ignore the email local-part so an unnamed user gets the
  // friendly fallback the greeting renders instead of a raw handle.
  const rawName = user?.display_name?.trim() || user?.name?.trim() || null;
  const firstName = rawName ? (rawName.split(/\s+/)[0] ?? null) : null;

  // Greeting subtitle: the firm name only. Today's date is appended CLIENT-
  // side by DashboardGreeting from the user's local clock — rendering it here
  // would bake in the server's UTC "today", which is already tomorrow during
  // a Quebec evening.
  const subtitle = firm?.name ?? "";

  // Hierarchy (top to bottom) = the accountant's actual priority: glance
  // (stats) + act (Needs attention), work (My engagements), start something
  // new (templates, demoted to a slim secondary strip).
  return (
    <div className="space-y-10 sm:space-y-12">
      {/* The What's-new feed rides in the header bell: rows render on the
          server here and slide out from the right edge on demand. */}
      <DashboardHeader
        firstName={firstName}
        subtitle={subtitle}
        bell={
          <WhatsNewBell count={notifications.length}>
            <WhatsNewFeed notifications={notifications} locale={locale} />
          </WhatsNewBell>
        }
      />

      {/* Top region: a thin full-width stats strip sitting directly above a
          full-width Needs attention block. Stacked (not side-by-side columns)
          so there is no uneven-height dead space, and tightly spaced so the
          strip reads as a quiet header to Needs attention, which stays high
          and prominent. */}
      <div className="space-y-5 sm:space-y-6">
        {/* At-a-glance counts — quiet, clickable, computed from the same
            worklist rows (and the same status engine) as everything else.
            Firm-wide on purpose: the linked views are firm-wide too, so a
            staff member's click always lands on a list matching the count. */}
        <OverviewStatsStrip rows={worklistRows} />

        {/* Needs attention — the prominent, accent-tinted action block,
            expanded by default. Always rendered (calm "all caught up" line
            when empty). Rows carry the same right-click / "..." menu as the
            My-engagements table. */}
        <NeedsAttention
          rows={attentionRows}
          canDelete={user ? canDeleteEngagements(user.role) : false}
        />
      </div>

      {/* Recent/Mine show active work; the Complete tab surfaces finished
          engagements. The worklist filters per-tab, so it gets every row. */}
      <EngagementsWorklist
        rows={worklistRows}
        currentUserId={user?.id ?? null}
        isOwner={user?.role === "owner"}
        teamEnabled={teamEnabled}
        locale={locale}
        canDelete={user ? canDeleteEngagements(user.role) : false}
      />

      {/* Start from a template — deliberately demoted BELOW the work: a
          slim, quiet quick-start strip, clearly secondary to engagements. */}
      <TemplatesGallery templates={templateCards} />
    </div>
  );
}

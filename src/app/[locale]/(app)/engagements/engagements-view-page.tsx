import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import { getCurrentUser, listActiveFirmUsers } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { canDeleteEngagements } from "@/lib/engagements/lifecycle";
import {
  scopeForView,
  selectView,
  viewTitleKey,
  type EngagementView,
} from "@/lib/engagements/views";
import { getEngagementBadges } from "@/lib/engagements/badges";
import { EngagementsView } from "@/components/engagements/engagements-view";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { hasActiveTeam } from "@/lib/team/mode";

// Shared server render for every All-Engagements sub-page. Each route file
// (/engagements, /engagements/ready, …) just calls this with its view. Loads
// the view's lifecycle scope, filters to the view, and hands rows + badges to
// the client component. The active-scope load + the badge counts dedupe via
// React.cache, so a page at "active" scope is a single query.
export async function renderEngagementsView({
  view,
  params,
}: {
  view: EngagementView;
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [rows, user, firm, activeMembers, badges] = await Promise.all([
    loadEngagementWorklist(scopeForView(view)),
    getCurrentUser(),
    getCurrentFirm(),
    listActiveFirmUsers(),
    getEngagementBadges(),
  ]);
  const t = await getTranslations("Engagements");
  const canDelete = user ? canDeleteEngagements(user.role) : false;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t(viewTitleKey(view))}
        </h1>
        {/* Primary action: start a new engagement straight from the list,
            instead of routing through Templates. Same control as the dashboard
            header. */}
        <Button asChild className="shrink-0 self-start sm:self-auto">
          <Link href="/engagements/new">
            <Plus className="h-4 w-4" />
            {t("new")}
          </Link>
        </Button>
      </header>

      <EngagementsView
        view={view}
        rows={selectView(view, rows)}
        locale={locale}
        canDelete={canDelete}
        currentUserId={user?.id ?? null}
        teamEnabled={hasActiveTeam({
          teamEnabled: firm?.team_enabled === true,
          activeMemberCount: activeMembers.length,
        })}
        badges={{ ready: badges.readyToReview, deleted: badges.recentlyDeleted }}
      />
    </div>
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import {
  getCurrentUser,
  listActiveFirmUsers,
  userDisplayLabel,
} from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { canDeleteEngagements } from "@/lib/engagements/lifecycle";
import {
  MENU_VIEWS,
  scopeForView,
  selectView,
  viewHref,
  viewLabelKey,
  viewTitleKey,
  type EngagementView,
} from "@/lib/engagements/views";
import { getEngagementBadges } from "@/lib/engagements/badges";
import { listSavedViews } from "@/lib/db/saved-views";
import { EngagementsView } from "@/components/engagements/engagements-view";
import { loadBoardNumbers } from "@/lib/db/engagement-board";
import { listUserRates } from "@/lib/db/user-rates";
import { can } from "@/lib/auth/capabilities";
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

  const [rows, user, firm, activeMembers, badges, savedViews] =
    await Promise.all([
    loadEngagementWorklist(scopeForView(view)),
    getCurrentUser(),
    getCurrentFirm(),
    listActiveFirmUsers(),
    getEngagementBadges(),
    // This person's own saved filter sets for this list (1630).
    listSavedViews("engagements"),
  ]);
  const t = await getTranslations("Engagements");
  const canDelete = user ? canDeleteEngagements(user.role) : false;

  // ── THE CAPACITY BOARD'S NUMBERS ──────────────────────────────────────
  //
  // Loaded here, on the server, for the rows this view actually shows: budget
  // assembled from each job's services, actual summed from real time entries.
  const viewRows = selectView(view, rows);
  const boardNumbers = await loadBoardNumbers(viewRows.map((r) => r.id));

  // ⚠️ MONEY IS OWNERS-ONLY. The founder's ruling, and the rule the
  // time-tracking work established: staff must never see a rate or a
  // labour-cost number. Without `rates.manage` this stays null and the board
  // renders hours alone — same four cells, one less number.
  //
  // The rate is the firm's own median-ish answer: the caller's billable rate
  // where they have one. RLS already returns nothing to anyone who may not
  // read rates, so this is belt AND braces.
  let boardRateCents: number | null = null;
  if (can(user, "rates.manage")) {
    try {
      const rates = await listUserRates();
      const mine = rates.find((r) => r.user_id === user?.id);
      const hourly =
        mine?.billable_rate_hourly ??
        rates.find((r) => r.billable_rate_hourly != null)?.billable_rate_hourly ??
        null;
      boardRateCents = hourly == null ? null : Math.round(hourly * 100);
    } catch {
      // user_rates predates 1750 on some databases. No rate simply means the
      // board shows hours, which is the same thing staff see.
      boardRateCents = null;
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t(viewTitleKey(view))}
        </h1>
        {/* Primary action: start a new engagement straight from the list,
            instead of routing through Templates. VYLAN'S BLUE (--accent), the
            same one "+ Add task" now uses — the product should have one
            call-to-action colour, not a navy on this page and a blue on that. */}
        <div className="flex shrink-0 items-center gap-1 self-start sm:self-auto">
          <Button asChild variant="accent">
            <Link href="/engagements/new">
              <Plus className="h-4 w-4" />
              {t("new")}
            </Link>
          </Button>
        </div>
      </header>

      <EngagementsView
        savedViews={savedViews}
        // The three overflow views travel WITH the saved ones now — one ⋯ on
        // the page, beside the list it filters rather than up in the header
        // where it could not reach the filters a view has to capture.
        viewLinks={MENU_VIEWS.map((v) => ({
          href: viewHref(v),
          label: t(viewLabelKey(v)),
          count:
            v === "ready"
              ? badges.readyToReview
              : v === "deleted"
                ? badges.recentlyDeleted
                : undefined,
        }))}
        view={view}
        rows={viewRows}
        boardNumbers={Object.fromEntries(boardNumbers)}
        boardRateCents={boardRateCents}
        locale={locale}
        canDelete={canDelete}
        currentUserId={user?.id ?? null}
        teamEnabled={hasActiveTeam({
          teamEnabled: firm?.team_enabled === true,
          activeMemberCount: activeMembers.length,
        })}
        firmId={firm?.id ?? null}
        assignMembers={activeMembers.map((m) => ({
          id: m.id,
          name: userDisplayLabel(m),
        }))}
        badges={{ ready: badges.readyToReview, deleted: badges.recentlyDeleted }}
      />
    </div>
  );
}

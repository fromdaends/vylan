import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import { getCurrentUser } from "@/lib/db/users";
import { canDeleteEngagements } from "@/lib/engagements/lifecycle";
import {
  scopeForView,
  selectView,
  viewTitleKey,
  type EngagementView,
} from "@/lib/engagements/views";
import { getEngagementBadges } from "@/lib/engagements/badges";
import { EngagementsView } from "@/components/engagements/engagements-view";

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

  const [rows, user, badges] = await Promise.all([
    loadEngagementWorklist(scopeForView(view)),
    getCurrentUser(),
    getEngagementBadges(),
  ]);
  const t = await getTranslations("Engagements");
  const canDelete = user ? canDeleteEngagements(user.role) : false;

  return (
    <div className="space-y-8">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t(viewTitleKey(view))}
        </h1>
      </header>

      <EngagementsView
        view={view}
        rows={selectView(view, rows)}
        locale={locale}
        canDelete={canDelete}
        badges={{ ready: badges.readyToReview, deleted: badges.recentlyDeleted }}
      />
    </div>
  );
}

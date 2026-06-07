import { setRequestLocale } from "next-intl/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { listTemplates, BLANK_TEMPLATE_ID } from "@/lib/db/templates";

export const dynamic = "force-dynamic";
import { assertLocale } from "@/lib/locale";
import { formatDate } from "@/lib/format";
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
import { JumpBackIn } from "@/components/engagements/jump-back-in";
import { WhatsNewFeed } from "@/components/inbox/whats-new-feed";
import { NeedsAttention } from "@/components/dashboard/needs-attention";

// The Overview is the single home that answers all three of an accountant's
// questions: what to do now (Needs attention), what's my work (My engagements),
// and what just happened (What's new). Two-column on desktop — a wide main
// column + a sticky ~320px right rail for What's new; stacks to one column
// below lg (the right rail drops under My engagements).
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
  const [worklistRows, firm, templates, notifications] = await Promise.all([
    loadEngagementWorklist(),
    getCurrentFirm(),
    listTemplates(),
    listHomeNotifications(12, viewer),
  ]);

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
      name: tmpl.name,
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

  // Greeting subtitle: firm name · today's date (carried over from the old
  // Home page greeting).
  const dateStr = formatDate(new Date(), locale, "long");
  const subtitle = firm?.name ? `${firm.name} · ${dateStr}` : dateStr;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
      {/* Main column */}
      <div className="min-w-0 space-y-10 sm:space-y-12">
        <DashboardHeader firstName={firstName} subtitle={subtitle} />

        {/* Jump back in — sits right under the header (fast path back to work).
            Shows only when the user has opened an engagement recently (tracked
            client-side); the component resolves which one + self-hides. */}
        <JumpBackIn
          engagements={worklistRows.map((r) => ({
            id: r.id,
            title: r.title,
            clientName: r.clientName,
            recencyAt: r.recencyAt,
          }))}
          locale={locale}
        />

        {/* Needs attention — prominent, accent-tinted action block. Always
            rendered (shows a calm "all caught up" line when empty). Rows carry
            the same right-click / "..." menu as the My-engagements table. */}
        <NeedsAttention
          rows={attentionRows}
          canDelete={user ? canDeleteEngagements(user.role) : false}
        />

        <TemplatesGallery templates={templateCards} />

        {/* Recent/Mine show active work; the Complete tab surfaces finished
            engagements. The worklist filters per-tab, so it gets every row. */}
        <EngagementsWorklist
          rows={worklistRows}
          currentUserId={user?.id ?? null}
          isOwner={user?.role === "owner"}
          locale={locale}
          canDelete={user ? canDeleteEngagements(user.role) : false}
        />

        {/* What's new — on mobile/tablet the right rail collapses to here,
            under My engagements. Hidden on lg where the sticky rail shows it. */}
        <div className="lg:hidden">
          <WhatsNewFeed notifications={notifications} locale={locale} />
        </div>
      </div>

      {/* Right rail — sticky on desktop; hidden below lg (shown inline above). */}
      <aside className="hidden lg:block">
        <div className="sticky top-8">
          <WhatsNewFeed notifications={notifications} locale={locale} />
        </div>
      </aside>
    </div>
  );
}

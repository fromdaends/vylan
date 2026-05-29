import { getTranslations, setRequestLocale } from "next-intl/server";
import { assertLocale } from "@/lib/locale";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import {
  selectNeedsAttention,
  selectReadyToReview,
} from "@/lib/dashboard/worklist-select";
import { listHomeNotifications } from "@/lib/home/notifications";
import { WorklistTable } from "@/components/dashboard/engagements-worklist";
import { WhatsNewFeed } from "@/components/inbox/whats-new-feed";
import { InboxSection } from "@/components/inbox/inbox-section";

export const dynamic = "force-dynamic";

// /inbox — the triage hub. Three sections, all reusing existing data sources:
//   1. Needs attention   — engagements with any attention reason (overdue,
//                          due soon, gone quiet). Same scoring as the dashboard.
//   2. Ready to review   — engagements with every required item in, awaiting a
//                          decision.
//   3. What's new        — the activity feed lifted from the old Home page.
export default async function InboxPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [rows, notifications] = await Promise.all([
    loadEngagementWorklist(),
    listHomeNotifications(12),
  ]);

  const needsAttention = selectNeedsAttention(rows);
  const readyToReview = selectReadyToReview(rows);

  const t = await getTranslations("Inbox");
  const tAttention = await getTranslations("Attention");

  return (
    <div className="space-y-10 sm:space-y-12">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      {/* 1. What's new — always expanded, fixed at the top (not collapsible),
          including its "View all" link. */}
      <WhatsNewFeed notifications={notifications} locale={locale} />

      {/* 2. Needs attention — collapsible, collapsed on load. */}
      <InboxSection title={tAttention("needs_attention")} defaultOpen={false}>
        <WorklistTable
          rows={needsAttention}
          locale={locale}
          emptyText={t("empty_attention")}
        />
      </InboxSection>

      {/* 3. Ready to review — collapsible, collapsed on load. */}
      <InboxSection title={tAttention("ready_to_review")} defaultOpen={false}>
        <WorklistTable
          rows={readyToReview}
          locale={locale}
          emptyText={t("empty_ready")}
        />
      </InboxSection>
    </div>
  );
}

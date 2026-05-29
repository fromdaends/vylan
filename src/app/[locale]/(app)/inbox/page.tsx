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

      <section aria-label={tAttention("needs_attention")} className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {tAttention("needs_attention")}
        </h2>
        <WorklistTable
          rows={needsAttention}
          locale={locale}
          emptyText={t("empty_attention")}
        />
      </section>

      <section aria-label={tAttention("ready_to_review")} className="space-y-4">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          {tAttention("ready_to_review")}
        </h2>
        <WorklistTable
          rows={readyToReview}
          locale={locale}
          emptyText={t("empty_ready")}
        />
      </section>

      <WhatsNewFeed notifications={notifications} locale={locale} />
    </div>
  );
}

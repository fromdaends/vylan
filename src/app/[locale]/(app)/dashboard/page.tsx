import { setRequestLocale } from "next-intl/server";
import { listEngagements, type Engagement } from "@/lib/db/engagements";
import { listClients } from "@/lib/db/clients";
import { getCurrentUser, listFirmUsers, userDisplayLabel } from "@/lib/db/users";
import { listTemplates } from "@/lib/db/templates";

export const dynamic = "force-dynamic";
import { assertLocale } from "@/lib/locale";
import {
  computeAttention,
  attentionScore,
  isReadyToReview,
  type AttentionResult,
} from "@/lib/attention";
import { getServerSupabase } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import {
  TemplatesGallery,
  type TemplateCard,
} from "@/components/dashboard/templates-gallery";
import {
  EngagementsWorklist,
  type WorklistRow,
} from "@/components/dashboard/engagements-worklist";

type RowVm = {
  engagement: Engagement;
  attention: AttentionResult;
};

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [engagements, clients, user, templates, firmUsers] = await Promise.all([
    listEngagements(),
    listClients({ includeArchived: false }),
    getCurrentUser(),
    listTemplates(),
    listFirmUsers(),
  ]);

  const templateCards: TemplateCard[] = templates.map((tmpl) => ({
    id: tmpl.id,
    name: tmpl.name,
    type: tmpl.type,
    itemCount: tmpl.items.length,
    builtIn: tmpl.firm_id == null,
  }));

  // First name only — prefer the explicit display_name, fall back to the
  // account name; ignore the email local-part so an unnamed user gets the
  // friendly "there"/"vous" fallback instead of a raw handle.
  const rawName = user?.display_name?.trim() || user?.name?.trim() || null;
  const firstName = rawName ? (rawName.split(/\s+/)[0] ?? null) : null;

  const sb = await getServerSupabase();
  const liveIds = engagements
    .filter((e) => e.status === "sent" || e.status === "in_progress")
    .map((e) => e.id);

  const [allItemsResp, lastActivityResp] = await Promise.all([
    sb
      .from("request_items")
      .select("*")
      .in("engagement_id", liveIds.length ? liveIds : [""]),
    sb
      .from("uploaded_files")
      .select("engagement_id, uploaded_at")
      .in("engagement_id", liveIds.length ? liveIds : [""]),
  ]);
  const itemsByEng = new Map<string, NonNullable<typeof allItemsResp.data>>();
  for (const it of allItemsResp.data ?? []) {
    const arr = itemsByEng.get(it.engagement_id) ?? [];
    arr.push(it as never);
    itemsByEng.set(it.engagement_id, arr as never);
  }
  const lastActByEng = new Map<string, string>();
  for (const u of lastActivityResp.data ?? []) {
    const prev = lastActByEng.get(u.engagement_id);
    if (!prev || u.uploaded_at > prev) {
      lastActByEng.set(u.engagement_id, u.uploaded_at);
    }
  }

  const clientsById = new Map(clients.map((c) => [c.id, c]));
  const userLabelById = new Map(
    firmUsers.map((u) => [u.id, userDisplayLabel(u)]),
  );

  const vms: RowVm[] = engagements.map((e) => ({
    engagement: e,
    attention: computeAttention({
      engagement: e,
      items: (itemsByEng.get(e.id) ?? []) as never,
      lastClientActivityAt: lastActByEng.get(e.id) ?? null,
    }),
  }));

  // The header shows the count in its subtitle; the worklist recomputes
  // its own from the rows so the two never drift.
  const attentionCount = vms.filter(
    (v) => v.attention.reasons.length > 0,
  ).length;

  // "Recency" for the Recent filter: the most recent of created, sent, or
  // last client upload. All ISO 8601, so a string compare is chronological.
  const recencyOf = (e: Engagement): string => {
    let latest = e.created_at;
    if (e.sent_at && e.sent_at > latest) latest = e.sent_at;
    const act = lastActByEng.get(e.id);
    if (act && act > latest) latest = act;
    return latest;
  };

  const worklistRows: WorklistRow[] = vms.map(({ engagement: e, attention: a }) => ({
    id: e.id,
    title: e.title,
    clientName: clientsById.get(e.client_id)?.display_name ?? "—",
    status: e.status,
    dueDate: e.due_date,
    assigneeUserId: e.assigned_user_id,
    assigneeName: e.assigned_user_id
      ? (userLabelById.get(e.assigned_user_id) ?? null)
      : null,
    completionPct: a.completionPct,
    itemsDone: a.itemsDone,
    itemsTotal: a.itemsTotal,
    attentionScore: attentionScore(a),
    reasons: a.reasons,
    daysOverdue: a.daysOverdue,
    daysUntilDue: a.daysUntilDue,
    daysSinceClientActivity: a.daysSinceClientActivity,
    readyToReview: isReadyToReview(a),
    itemsReadyToReview: a.itemsReadyToReview,
    recencyAt: recencyOf(e),
  }));

  return (
    <div className="space-y-10 sm:space-y-12">
      <DashboardHeader firstName={firstName} attentionCount={attentionCount} />

      <TemplatesGallery templates={templateCards} />

      <EngagementsWorklist
        rows={worklistRows}
        currentUserId={user?.id ?? null}
        locale={locale}
      />
    </div>
  );
}

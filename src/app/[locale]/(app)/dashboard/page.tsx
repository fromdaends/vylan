import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { listEngagements } from "@/lib/db/engagements";
import { listClients } from "@/lib/db/clients";

export const dynamic = "force-dynamic";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { Plus } from "lucide-react";
import { computeAttention, isReadyToReview } from "@/lib/attention";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  EngagementList,
  type EngagementRow,
} from "@/components/dashboard/engagement-list";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [firm, engagements, clients] = await Promise.all([
    getCurrentFirm(),
    listEngagements(),
    listClients({ includeArchived: false }),
  ]);

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

  // AI-rejected files in the last 7 days, indexed by engagement so we
  // can stamp counts + last-flag time onto each engagement row.
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const allEngagementIds = engagements.map((e) => e.id);
  type AiRejectedRow = {
    engagement_id: string;
    uploaded_at: string;
  };
  const aiRejectedRows: AiRejectedRow[] = allEngagementIds.length
    ? ((
        await sb
          .from("uploaded_files")
          .select("engagement_id, uploaded_at")
          .in("engagement_id", allEngagementIds)
          .eq("ai_rejected", true)
          .gte("uploaded_at", sevenDaysAgo)
          .order("uploaded_at", { ascending: false })
      ).data as unknown as AiRejectedRow[] | null) ?? []
    : [];
  const aiFlaggedByEng = new Map<
    string,
    { count: number; lastFlagAt: string }
  >();
  for (const r of aiRejectedRows) {
    const cur = aiFlaggedByEng.get(r.engagement_id);
    if (cur) {
      cur.count += 1;
      if (r.uploaded_at > cur.lastFlagAt) cur.lastFlagAt = r.uploaded_at;
    } else {
      aiFlaggedByEng.set(r.engagement_id, {
        count: 1,
        lastFlagAt: r.uploaded_at,
      });
    }
  }

  const clientsById = new Map(clients.map((c) => [c.id, c]));

  // Build the unified row list — one row per engagement, all lanes
  // computed flat so the Client Component just renders + filters.
  const rows: EngagementRow[] = engagements.map((e) => {
    const items = itemsByEng.get(e.id) ?? [];
    const att = computeAttention({
      engagement: e,
      items: items as never,
      lastClientActivityAt: lastActByEng.get(e.id) ?? null,
    });
    const ai = aiFlaggedByEng.get(e.id);
    return {
      id: e.id,
      title: e.title,
      status: e.status,
      clientId: e.client_id,
      clientName: clientsById.get(e.client_id)?.display_name ?? "—",
      isOverdue: att.reasons.includes("overdue"),
      daysOverdue: att.daysOverdue,
      isDueSoon: att.reasons.includes("due_soon"),
      daysUntilDue: att.daysUntilDue,
      isStale: att.reasons.includes("stale"),
      daysSinceActivity: att.daysSinceClientActivity,
      isReadyToReview:
        (e.status === "sent" || e.status === "in_progress") &&
        isReadyToReview(att),
      itemsReadyToReview: att.itemsReadyToReview,
      aiFlaggedCount: ai?.count ?? 0,
      lastFlagAt: ai?.lastFlagAt ?? null,
    };
  });

  // Tile counts derive from the same rows so the chips below match.
  const overdueCount = rows.filter((r) => r.isOverdue).length;
  const activeCount = rows.filter(
    (r) => r.status === "sent" || r.status === "in_progress",
  ).length;
  const aiFlaggedTotalCount = aiRejectedRows.length;

  const t = await getTranslations("App");
  const tEng = await getTranslations("Engagements");
  const tAttention = await getTranslations("Attention");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 animate-in-up">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("dashboard_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">{firm?.name}</p>
        </div>
        <Link href="/engagements/new">
          <Button>
            <Plus className="h-4 w-4" />
            {tEng("new")}
          </Button>
        </Link>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-in-stagger">
        <Metric
          label={t("metric_clients")}
          value={clients.length}
          href="/clients"
        />
        <Metric
          label={tAttention("metric_active")}
          value={activeCount}
          hashFilter="active"
        />
        <Metric
          label={tAttention("metric_overdue")}
          value={overdueCount}
          tone={overdueCount > 0 ? "warning" : "default"}
          hashFilter="needs-attention"
        />
        <Metric
          label={tAttention("metric_ai_rejected_week")}
          value={aiFlaggedTotalCount}
          tone={aiFlaggedTotalCount > 0 ? "warning" : "default"}
          hashFilter="ai-flagged"
        />
      </div>

      <EngagementList rows={rows} />
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
  href,
  hashFilter,
}: {
  label: string;
  value: number;
  tone?: "default" | "warning";
  href?: string;
  hashFilter?: string;
}) {
  const inner = (
    <>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium transition-colors group-hover:text-foreground">
        {label}
      </div>
      <div
        className={
          "text-3xl font-semibold tracking-tight mt-2 font-mono tabular-nums " +
          (tone === "warning" && value > 0 ? "text-warning" : "")
        }
      >
        {value}
      </div>
    </>
  );
  const base =
    "group block rounded-xl border border-border bg-card px-5 py-4 hover-lift transition-colors hover:border-foreground/20";
  if (href) {
    return (
      <Link href={href} className={base + " cursor-pointer no-underline"}>
        {inner}
      </Link>
    );
  }
  if (hashFilter) {
    return (
      <a
        href={`#${hashFilter}`}
        className={base + " cursor-pointer no-underline"}
      >
        {inner}
      </a>
    );
  }
  return <div className={base}>{inner}</div>;
}

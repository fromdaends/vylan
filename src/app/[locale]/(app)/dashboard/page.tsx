import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { listEngagements, type Engagement } from "@/lib/db/engagements";
import { listClients } from "@/lib/db/clients";
import { listRequestItems } from "@/lib/db/request-items";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { Plus, AlertTriangle, Clock, FileWarning, CheckCheck } from "lucide-react";
import {
  computeAttention,
  attentionScore,
  isReadyToReview,
  type AttentionResult,
} from "@/lib/attention";
import { getServerSupabase } from "@/lib/supabase/server";

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

  const [firm, engagements, clients] = await Promise.all([
    getCurrentFirm(),
    listEngagements(),
    listClients({ includeArchived: false }),
  ]);

  // Batch-fetch items + last-activity per engagement.
  const sb = await getServerSupabase();
  const liveIds = engagements
    .filter((e) => e.status === "sent" || e.status === "in_progress")
    .map((e) => e.id);

  const [allItemsResp, lastActivityResp] = await Promise.all([
    sb.from("request_items").select("*").in("engagement_id", liveIds.length ? liveIds : [""]),
    sb
      .from("uploaded_files")
      .select("engagement_id, uploaded_at")
      .in("engagement_id", liveIds.length ? liveIds : [""]),
  ]);
  const itemsByEng = new Map<string, typeof allItemsResp.data>();
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

  const vms: RowVm[] = engagements.map((e) => {
    const items = (itemsByEng.get(e.id) ?? []) as Awaited<
      ReturnType<typeof listRequestItems>
    >;
    return {
      engagement: e,
      attention: computeAttention({
        engagement: e,
        items,
        lastClientActivityAt: lastActByEng.get(e.id) ?? null,
      }),
    };
  });

  const needsAttention = vms
    .filter((v) => v.attention.reasons.length > 0)
    .sort((a, b) => attentionScore(b.attention) - attentionScore(a.attention));
  const readyToReview = vms.filter(
    (v) =>
      (v.engagement.status === "sent" ||
        v.engagement.status === "in_progress") &&
      isReadyToReview(v.attention),
  );
  // All other engagements that are alive but quiet — drafts, sent-but-fresh,
  // recently complete. Surfaced as a catch-all so nothing goes missing.
  const flaggedIds = new Set(
    [...needsAttention, ...readyToReview].map((v) => v.engagement.id),
  );
  const other = vms.filter((v) => !flaggedIds.has(v.engagement.id)).slice(0, 8);

  // Top metrics.
  const activeCount = vms.filter(
    (v) =>
      v.engagement.status === "sent" || v.engagement.status === "in_progress",
  ).length;
  const pendingItemsTotal = vms.reduce(
    (sum, v) => sum + v.attention.itemsPendingRequired,
    0,
  );
  const overdueCount = vms.filter((v) =>
    v.attention.reasons.includes("overdue"),
  ).length;

  const t = await getTranslations("App");
  const tEng = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");
  const tAttention = await getTranslations("Attention");
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("dashboard_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{firm?.name}</p>
        </div>
        <Link href="/engagements/new">
          <Button size="sm">
            <Plus className="size-4" />
            {tEng("new")}
          </Button>
        </Link>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Metric label={t("metric_clients")} value={clients.length} />
        <Metric label={tAttention("metric_active")} value={activeCount} />
        <Metric label={tAttention("metric_pending")} value={pendingItemsTotal} />
        <Metric
          label={tAttention("metric_overdue")}
          value={overdueCount}
          tone={overdueCount > 0 ? "warning" : "default"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            {tAttention("needs_attention")}{" "}
            <span className="text-muted-foreground font-normal">
              ({needsAttention.length})
            </span>
          </CardTitle>
          <CardDescription>{tAttention("needs_attention_hint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {needsAttention.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {tAttention("empty_attention")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {needsAttention.map((v) => (
                <AttentionRow
                  key={v.engagement.id}
                  v={v}
                  clientName={
                    clientsById.get(v.engagement.client_id)?.display_name ??
                    "—"
                  }
                  tStatus={tStatus}
                  tAttention={tAttention}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCheck className="size-4 text-success" />
            {tAttention("ready_to_review")}{" "}
            <span className="text-muted-foreground font-normal">
              ({readyToReview.length})
            </span>
          </CardTitle>
          <CardDescription>{tAttention("ready_to_review_hint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {readyToReview.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">
              {tAttention("empty_review")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {readyToReview.map((v) => (
                <li key={v.engagement.id} className="py-3">
                  <Link
                    href={`/engagements/${v.engagement.id}`}
                    className="flex items-center justify-between gap-3 hover:text-foreground"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {v.engagement.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {clientsById.get(v.engagement.client_id)?.display_name ??
                          "—"}
                      </div>
                    </div>
                    <Badge variant="secondary">
                      {tAttention("items_ready", {
                        count: v.attention.itemsReadyToReview,
                      })}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {other.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {tAttention("other_engagements")}{" "}
              <span className="text-muted-foreground font-normal">
                ({other.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {other.map((v) => (
                <li key={v.engagement.id} className="py-3">
                  <Link
                    href={`/engagements/${v.engagement.id}`}
                    className="flex items-center justify-between gap-3 hover:text-foreground"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {v.engagement.title}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {clientsById.get(v.engagement.client_id)?.display_name ??
                          "—"}
                      </div>
                    </div>
                    <Badge variant={statusBadge(v.engagement.status)}>
                      {tStatus(v.engagement.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function statusBadge(
  status: string,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "complete") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "draft") return "outline";
  return "secondary";
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning";
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground uppercase tracking-wide">
          {label}
        </div>
        <div
          className={`text-2xl font-semibold mt-1 ${
            tone === "warning" && value > 0 ? "text-warning" : ""
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function AttentionRow({
  v,
  clientName,
  tStatus,
  tAttention,
}: {
  v: RowVm;
  clientName: string;
  tStatus: Awaited<ReturnType<typeof getTranslations<"Status">>>;
  tAttention: Awaited<ReturnType<typeof getTranslations<"Attention">>>;
}) {
  const pct = Math.round(v.attention.completionPct * 100);
  return (
    <li className="py-3">
      <Link
        href={`/engagements/${v.engagement.id}`}
        className="flex items-center justify-between gap-3 hover:text-foreground"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{v.engagement.title}</span>
            <span className="text-xs text-muted-foreground">{clientName}</span>
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
            {v.attention.reasons.includes("overdue") && (
              <Badge variant="destructive">
                <AlertTriangle className="size-3" />
                {tAttention("overdue_by", {
                  days: v.attention.daysOverdue ?? 0,
                })}
              </Badge>
            )}
            {v.attention.reasons.includes("due_soon") && (
              <Badge variant="secondary">
                <Clock className="size-3" />
                {tAttention("due_in", {
                  days: v.attention.daysUntilDue ?? 0,
                })}
              </Badge>
            )}
            {v.attention.reasons.includes("stale") && (
              <Badge variant="outline">
                <FileWarning className="size-3" />
                {tAttention("stale_days", {
                  days: v.attention.daysSinceClientActivity ?? 0,
                })}
              </Badge>
            )}
            <span className="text-muted-foreground font-mono">
              {pct}% · {v.attention.itemsDone}/{v.attention.itemsTotal}
            </span>
          </div>
        </div>
        <Badge variant={v.engagement.status === "in_progress" ? "secondary" : "outline"}>
          {tStatus(v.engagement.status)}
        </Badge>
      </Link>
    </li>
  );
}

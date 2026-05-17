import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { listEngagements, type Engagement } from "@/lib/db/engagements";
import { listClients } from "@/lib/db/clients";

export const dynamic = "force-dynamic";
import { listRequestItems, type RequestItem } from "@/lib/db/request-items";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import {
  Plus,
  AlertTriangle,
  Clock,
  FileWarning,
  CheckCheck,
  ChevronRight,
  Inbox,
} from "lucide-react";
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
  const flaggedIds = new Set(
    [...needsAttention, ...readyToReview].map((v) => v.engagement.id),
  );
  const other = vms.filter((v) => !flaggedIds.has(v.engagement.id)).slice(0, 8);

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

  // Phase 5 — "AI-rejected this week" tile. Counts uploaded files
  // with ai_rejected=true across all of this firm's engagements
  // (not just live ones) over the last 7 days. Falls back to 0 on
  // query error so the dashboard never errors because of a missing
  // column on a fresh DB.
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const allEngagementIds = engagements.map((e) => e.id);
  const { count: aiRejectedWeekCount } = allEngagementIds.length
    ? await sb
        .from("uploaded_files")
        .select("id", { count: "exact", head: true })
        .in("engagement_id", allEngagementIds)
        .eq("ai_rejected", true)
        .gte("uploaded_at", sevenDaysAgo)
    : { count: 0 };

  const t = await getTranslations("App");
  const tEng = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");
  const tAttention = await getTranslations("Attention");
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  // Flat list of every required+pending item across live engagements, so
  // the "Pending items" metric tile can land on an actual list of what's
  // missing instead of just scrolling to the engagement-level section.
  // Sorted so the most urgent engagements' items appear first, with items
  // from the same engagement grouped together.
  const PENDING_ITEMS_CAP = 25;
  type PendingItemRow = {
    item: RequestItem;
    engagement: Engagement;
    clientName: string;
    score: number;
  };
  const pendingItemsAll: PendingItemRow[] = [];
  for (const v of vms) {
    if (
      v.engagement.status !== "sent" &&
      v.engagement.status !== "in_progress"
    ) {
      continue;
    }
    const items = (itemsByEng.get(v.engagement.id) ?? []) as RequestItem[];
    const score = attentionScore(v.attention);
    for (const it of items) {
      if (it.required && it.status === "pending") {
        pendingItemsAll.push({
          item: it,
          engagement: v.engagement,
          clientName:
            clientsById.get(v.engagement.client_id)?.display_name ?? "—",
          score,
        });
      }
    }
  }
  pendingItemsAll.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.engagement.id !== b.engagement.id) {
      return a.engagement.title.localeCompare(b.engagement.title);
    }
    return a.item.order_index - b.item.order_index;
  });
  const pendingItemsToShow = pendingItemsAll.slice(0, PENDING_ITEMS_CAP);
  const pendingItemsOverflow = pendingItemsAll.length - pendingItemsToShow.length;

  return (
    <div className="space-y-8">
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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 animate-in-stagger">
        <Metric
          label={t("metric_clients")}
          value={clients.length}
          href="/clients"
        />
        <Metric
          label={tAttention("metric_active")}
          value={activeCount}
          href="/clients"
        />
        <Metric
          label={tAttention("metric_pending")}
          value={pendingItemsTotal}
          href="#pending-items"
        />
        <Metric
          label={tAttention("metric_overdue")}
          value={overdueCount}
          tone={overdueCount > 0 ? "warning" : "default"}
          href="#needs-attention"
        />
        <Metric
          label={tAttention("metric_ai_rejected_week")}
          value={aiRejectedWeekCount ?? 0}
          href="#needs-attention"
        />
      </div>

      <Section
        id="pending-items"
        title={tAttention("pending_items_section")}
        count={pendingItemsTotal}
        hint={tAttention("pending_items_hint")}
        icon={<Clock className="h-4 w-4 text-muted-foreground" />}
      >
        {pendingItemsAll.length === 0 ? (
          <EmptyState
            icon={<CheckCheck className="h-5 w-5" />}
            text={tAttention("empty_pending")}
          />
        ) : (
          <>
            <ul className="divide-y divide-border/60">
              {pendingItemsToShow.map((row) => {
                const itemLabel =
                  locale === "fr" && row.item.label_fr
                    ? row.item.label_fr
                    : row.item.label;
                return (
                  <li key={row.item.id}>
                    <Link
                      href={`/engagements/${row.engagement.id}`}
                      className="flex items-center justify-between gap-3 py-3.5 px-1 -mx-1 rounded-md hover:bg-secondary/40 transition-colors group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">
                          {itemLabel}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {row.engagement.title} · {row.clientName}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            {pendingItemsOverflow > 0 && (
              <p className="text-xs text-muted-foreground mt-2 px-1 py-2">
                {tAttention("pending_items_more", {
                  count: pendingItemsOverflow,
                })}
              </p>
            )}
          </>
        )}
      </Section>

      <Section
        id="needs-attention"
        title={tAttention("needs_attention")}
        count={needsAttention.length}
        hint={tAttention("needs_attention_hint")}
        icon={<AlertTriangle className="h-4 w-4 text-warning" />}
      >
        {needsAttention.length === 0 ? (
          <EmptyState
            icon={<CheckCheck className="h-5 w-5" />}
            text={tAttention("empty_attention")}
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {needsAttention.map((v) => (
              <AttentionRow
                key={v.engagement.id}
                v={v}
                clientName={
                  clientsById.get(v.engagement.client_id)?.display_name ?? "—"
                }
                tStatus={tStatus}
                tAttention={tAttention}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={tAttention("ready_to_review")}
        count={readyToReview.length}
        hint={tAttention("ready_to_review_hint")}
        icon={<CheckCheck className="h-4 w-4 text-success" />}
      >
        {readyToReview.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            text={tAttention("empty_review")}
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {readyToReview.map((v) => (
              <li key={v.engagement.id}>
                <Link
                  href={`/engagements/${v.engagement.id}`}
                  className="flex items-center justify-between gap-3 py-3.5 px-1 -mx-1 rounded-md hover:bg-secondary/40 transition-colors group"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">
                      {v.engagement.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {clientsById.get(v.engagement.client_id)?.display_name ??
                        "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className="font-normal">
                      {tAttention("items_ready", {
                        count: v.attention.itemsReadyToReview,
                      })}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {other.length > 0 && (
        <Section
          title={tAttention("other_engagements")}
          count={other.length}
          hint=""
          icon={null}
        >
          <ul className="divide-y divide-border/60">
            {other.map((v) => (
              <li key={v.engagement.id}>
                <Link
                  href={`/engagements/${v.engagement.id}`}
                  className="flex items-center justify-between gap-3 py-3.5 px-1 -mx-1 rounded-md hover:bg-secondary/40 transition-colors group"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">
                      {v.engagement.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {clientsById.get(v.engagement.client_id)?.display_name ??
                        "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant={statusBadge(v.engagement.status)}
                      className="font-normal"
                    >
                      {tStatus(v.engagement.status)}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
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
  href,
}: {
  label: string;
  value: number;
  tone?: "default" | "warning";
  href?: string;
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
  if (!href) return <div className={base}>{inner}</div>;
  if (href.startsWith("#")) {
    return (
      <a href={href} className={base + " cursor-pointer no-underline"}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={base + " cursor-pointer no-underline"}>
      {inner}
    </Link>
  );
}

function Section({
  id,
  title,
  count,
  hint,
  icon,
  children,
}: {
  id?: string;
  title: string;
  count: number;
  hint: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-xl border border-border bg-card animate-in-up"
    >
      <header className="px-5 py-4 border-b border-border/60">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          <span>{title}</span>
          <span className="text-muted-foreground font-normal tabular-nums">
            ({count})
          </span>
        </div>
        {hint && (
          <p className="text-xs text-muted-foreground mt-1.5">{hint}</p>
        )}
      </header>
      <div className="px-5 py-2">{children}</div>
    </section>
  );
}

function EmptyState({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
      <div className="opacity-60">{icon}</div>
      <p className="text-sm">{text}</p>
    </div>
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
    <li>
      <Link
        href={`/engagements/${v.engagement.id}`}
        className="flex items-center justify-between gap-3 py-3.5 px-1 -mx-1 rounded-md hover:bg-secondary/40 transition-colors group"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">
              {v.engagement.title}
            </span>
            <span className="text-xs text-muted-foreground">{clientName}</span>
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
            {v.attention.reasons.includes("overdue") && (
              <Badge variant="destructive" className="font-normal">
                <AlertTriangle className="h-3 w-3" />
                {tAttention("overdue_by", {
                  days: v.attention.daysOverdue ?? 0,
                })}
              </Badge>
            )}
            {v.attention.reasons.includes("due_soon") && (
              <Badge variant="secondary" className="font-normal">
                <Clock className="h-3 w-3" />
                {tAttention("due_in", { days: v.attention.daysUntilDue ?? 0 })}
              </Badge>
            )}
            {v.attention.reasons.includes("stale") && (
              <Badge variant="outline" className="font-normal">
                <FileWarning className="h-3 w-3" />
                {tAttention("stale_days", {
                  days: v.attention.daysSinceClientActivity ?? 0,
                })}
              </Badge>
            )}
            <span className="text-muted-foreground font-mono tabular-nums">
              {pct}% · {v.attention.itemsDone}/{v.attention.itemsTotal}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant={
              v.engagement.status === "in_progress" ? "secondary" : "outline"
            }
            className="font-normal"
          >
            {tStatus(v.engagement.status)}
          </Badge>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
        </div>
      </Link>
    </li>
  );
}

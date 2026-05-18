import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { listEngagements, type Engagement } from "@/lib/db/engagements";
import { listClients } from "@/lib/db/clients";

export const dynamic = "force-dynamic";
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
  Sparkles,
} from "lucide-react";
import {
  computeAttention,
  attentionScore,
  isReadyToReview,
  type AttentionResult,
} from "@/lib/attention";
import { getServerSupabase } from "@/lib/supabase/server";
import { CollapsibleSection } from "@/components/dashboard/collapsible-section";
import {
  listAiActivityForFirm,
  type AiActivityEntry,
} from "@/lib/db/ai-activity";
import { formatRelative } from "@/lib/format";

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

  const vms: RowVm[] = engagements.map((e) => ({
    engagement: e,
    attention: computeAttention({
      engagement: e,
      items: (itemsByEng.get(e.id) ?? []) as never,
      lastClientActivityAt: lastActByEng.get(e.id) ?? null,
    }),
  }));

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
  const overdueCount = vms.filter((v) =>
    v.attention.reasons.includes("overdue"),
  ).length;

  // AI-rejected this week — counter at the top. Clicking it now opens
  // the /ai-activity page (full AI verdict feed across all engagements).
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

  // Recent AI activity — shown inline in the dashboard's AI activity
  // section. Capped at 25 since the section opens in place (no separate
  // page); 25 rows feels like a full feed without flooding the viewport.
  const recentAiActivity = await listAiActivityForFirm(25);

  const t = await getTranslations("App");
  const tEng = await getTranslations("Engagements");
  const tStatus = await getTranslations("Status");
  const tAttention = await getTranslations("Attention");
  const clientsById = new Map(clients.map((c) => [c.id, c]));

  // Short header previews so the accountant knows what's in each
  // section without expanding. Mirrors the row order inside each
  // section so the first row's name shows.
  const needsAttentionPreview =
    needsAttention.length === 0
      ? null
      : previewLine(
          needsAttention[0].engagement.title,
          clientsById.get(needsAttention[0].engagement.client_id)
            ?.display_name ?? null,
          needsAttention.length - 1,
        );
  const readyToReviewPreview =
    readyToReview.length === 0
      ? null
      : previewLine(
          readyToReview[0].engagement.title,
          clientsById.get(readyToReview[0].engagement.client_id)
            ?.display_name ?? null,
          readyToReview.length - 1,
        );
  const otherPreview =
    other.length === 0
      ? null
      : previewLine(
          other[0].engagement.title,
          clientsById.get(other[0].engagement.client_id)?.display_name ?? null,
          other.length - 1,
        );
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
          href="/clients"
        />
        <Metric
          label={tAttention("metric_overdue")}
          value={overdueCount}
          tone={overdueCount > 0 ? "warning" : "default"}
          hashFilter="needs-attention"
        />
        <Metric
          label={tAttention("metric_ai_rejected_week")}
          value={aiRejectedWeekCount ?? 0}
          tone={
            (aiRejectedWeekCount ?? 0) > 0 ? "warning" : "default"
          }
          hashFilter="ai-activity"
        />
      </div>

      <CollapsibleSection
        id="needs-attention"
        title={tAttention("needs_attention")}
        count={needsAttention.length}
        preview={needsAttentionPreview}
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
      </CollapsibleSection>

      <CollapsibleSection
        id="ready-to-review"
        title={tAttention("ready_to_review")}
        count={readyToReview.length}
        preview={readyToReviewPreview}
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
      </CollapsibleSection>

      <CollapsibleSection
        id="ai-activity"
        title={tAttention("ai_activity_section_title")}
        count={recentAiActivity.length}
        preview={
          recentAiActivity.length === 0
            ? null
            : aiActivityPreview(recentAiActivity[0], tAttention, locale)
        }
        hint={tAttention("ai_activity_section_hint")}
        icon={<Sparkles className="h-4 w-4 text-primary" />}
      >
        {recentAiActivity.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="h-5 w-5" />}
            text={tAttention("empty_ai_activity")}
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {recentAiActivity.map((e) => (
              <AiActivityRow
                key={e.id}
                entry={e}
                locale={locale}
                tAttention={tAttention}
              />
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="other-engagements"
        title={tAttention("other_engagements")}
        count={other.length}
        preview={otherPreview}
        icon={null}
      >
        {other.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-5 w-5" />}
            text={tAttention("empty_attention")}
          />
        ) : (
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
        )}
      </CollapsibleSection>

    </div>
  );
}

function previewLine(
  firstTitle: string,
  firstClient: string | null,
  more: number,
): string {
  const base = firstClient
    ? `${firstClient} · ${firstTitle}`
    : firstTitle;
  if (more <= 0) return base;
  return `${base} +${more}`;
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

function EmptyState({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-6 text-muted-foreground">
      <div className="opacity-60">{icon}</div>
      <p className="text-sm">{text}</p>
    </div>
  );
}

function aiActivityShortLabel(
  action: string,
  tAttention: Awaited<ReturnType<typeof getTranslations<"Attention">>>,
): string {
  // Short labels for the dashboard row + preview line. Avoids leaking
  // the noisy "🤖 confidence X%" wording from the full Activity strings
  // when space is tight.
  switch (action) {
    case "ai_classified":
      return tAttention("ai_action_classified");
    case "ai_auto_rejected":
      return tAttention("ai_action_auto_rejected");
    case "ai_escalated_to_accountant":
      return tAttention("ai_action_escalated");
    case "ai_quality_flagged":
      return tAttention("ai_action_quality_flagged");
    case "ai_rejection_overridden":
      return tAttention("ai_action_override");
    default:
      return action;
  }
}

function aiActivityPreview(
  entry: AiActivityEntry,
  tAttention: Awaited<ReturnType<typeof getTranslations<"Attention">>>,
  locale: "fr" | "en",
): string {
  const label = aiActivityShortLabel(entry.action, tAttention);
  const context =
    entry.client_display_name ?? entry.engagement_title ?? null;
  const when = formatRelative(entry.created_at, locale);
  return context ? `${label} · ${context} · ${when}` : `${label} · ${when}`;
}

function aiActionTone(action: string): string {
  switch (action) {
    case "ai_auto_rejected":
    case "ai_escalated_to_accountant":
      return "text-warning";
    case "ai_rejection_overridden":
      return "text-success";
    default:
      return "text-primary";
  }
}

function AiActivityRow({
  entry,
  locale,
  tAttention,
}: {
  entry: AiActivityEntry;
  locale: "fr" | "en";
  tAttention: Awaited<ReturnType<typeof getTranslations<"Attention">>>;
}) {
  const label = aiActivityShortLabel(entry.action, tAttention);
  const tone = aiActionTone(entry.action);
  const href = entry.engagement_id
    ? `/engagements/${entry.engagement_id}`
    : null;
  const row = (
    <div className="flex items-start gap-3 py-3 px-1 -mx-1 rounded-md group">
      <Sparkles className={"h-3.5 w-3.5 mt-1 shrink-0 " + tone} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-snug truncate">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {entry.engagement_title && (
            <span className="truncate max-w-[18rem]">
              {entry.engagement_title}
            </span>
          )}
          {entry.client_display_name && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate max-w-[14rem]">
                {entry.client_display_name}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>{formatRelative(entry.created_at, locale)}</span>
        </div>
      </div>
      {href && (
        <ChevronRight
          className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors mt-1.5 shrink-0"
          aria-hidden
        />
      )}
    </div>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="block hover:bg-secondary/40 transition-colors rounded-md"
        >
          {row}
        </Link>
      ) : (
        row
      )}
    </li>
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

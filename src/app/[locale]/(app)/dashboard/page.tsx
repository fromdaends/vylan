import { getTranslations, setRequestLocale } from "next-intl/server";
import { listEngagements, type Engagement } from "@/lib/db/engagements";
import { listClients } from "@/lib/db/clients";
import { getCurrentUser } from "@/lib/db/users";
import { listTemplates } from "@/lib/db/templates";

export const dynamic = "force-dynamic";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import {
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
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import {
  TemplatesGallery,
  type TemplateCard,
} from "@/components/dashboard/templates-gallery";
import { CollapsibleSection } from "@/components/dashboard/collapsible-section";
import { HashSectionLink } from "@/components/dashboard/hash-section-link";
import { AiActivityList } from "@/components/dashboard/ai-activity-list";
import { aiActivityShortLabel } from "@/components/dashboard/ai-activity-shared";
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

  const [engagements, clients, user, templates] = await Promise.all([
    listEngagements(),
    listClients({ includeArchived: false }),
    getCurrentUser(),
    listTemplates(),
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

  // AI activity — rolling 7-day window so the section auto-resets
  // every week. Capped at 200 rows; with a week of activity that's
  // plenty even for a busy firm, and the client-side "Search client"
  // box filters within that set.
  const recentAiActivity = await listAiActivityForFirm(200, sevenDaysAgo);

  const t = await getTranslations("App");
  const tDashboard = await getTranslations("Dashboard");
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
    <div className="space-y-10 sm:space-y-12">
      <DashboardHeader
        firstName={firstName}
        attentionCount={needsAttention.length}
      />

      <TemplatesGallery templates={templateCards} />

      <section
        aria-label={tDashboard("overview_label")}
        className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 animate-in-stagger"
      >
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
          tone={(aiRejectedWeekCount ?? 0) > 0 ? "warning" : "default"}
          hashFilter="ai-activity"
        />
      </section>

      <div className="space-y-3">
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
                    clientsById.get(v.engagement.client_id)?.display_name ??
                    "—"
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
                        {clientsById.get(v.engagement.client_id)
                          ?.display_name ?? "—"}
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
            <AiActivityList entries={recentAiActivity} locale={locale} />
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
                        {clientsById.get(v.engagement.client_id)
                          ?.display_name ?? "—"}
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
  const highlighted = tone === "warning" && value > 0;
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] text-muted-foreground uppercase tracking-[0.14em] font-medium transition-colors group-hover:text-foreground/90">
          {label}
        </span>
        {highlighted && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-warning shrink-0 mt-1.5"
            aria-hidden
          />
        )}
      </div>
      <div
        className={
          "text-4xl font-semibold tracking-tight mt-3 font-mono tabular-nums leading-none " +
          (highlighted ? "text-warning" : "text-foreground")
        }
      >
        {value}
      </div>
    </>
  );
  // Tasteful tile: soft border, gentle hover (slight border + bg lift,
  // no heavy shadow). Same chrome whether the tile is a link or static.
  const base =
    "group block rounded-xl border border-border/80 bg-card px-5 py-5 " +
    "transition-colors hover:border-foreground/25 hover:bg-card/90 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";
  if (href) {
    return (
      <Link href={href} className={base + " cursor-pointer no-underline"}>
        {inner}
      </Link>
    );
  }
  if (hashFilter) {
    return (
      <HashSectionLink
        hash={hashFilter}
        className={base + " cursor-pointer no-underline"}
      >
        {inner}
      </HashSectionLink>
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
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
      <div
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary/40 text-muted-foreground/80"
        aria-hidden
      >
        {icon}
      </div>
      <p className="text-sm">{text}</p>
    </div>
  );
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

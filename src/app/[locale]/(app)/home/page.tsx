import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { listClients } from "@/lib/db/clients";
import { listEngagements } from "@/lib/db/engagements";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { assertLocale } from "@/lib/locale";
import { formatDate, formatRelative } from "@/lib/format";
import { DashboardGreeting } from "@/components/dashboard/dashboard-greeting";
import { HomeSearch } from "@/components/home/home-search";
import {
  listHomeNotifications,
  type HomeNotification,
} from "@/lib/home/notifications";
import {
  AlertTriangle,
  ArrowRight,
  CheckCheck,
  ChevronRight,
  Inbox,
  LayoutDashboard,
  Sparkles,
  Users,
  Briefcase,
  type LucideIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Home — the post-login landing page. Designed as a glance: greeting,
// recent activity, search, shortcuts. The detailed grouped breakdown
// lives on /dashboard and is reached from the "View full dashboard"
// CTA at the top right.
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const [firm, user, clients, engagements, notifications] = await Promise.all([
    getCurrentFirm(),
    getCurrentUser(),
    listClients({ includeArchived: false }),
    listEngagements(),
    listHomeNotifications(12),
  ]);

  const t = await getTranslations("Home");

  const firstName = pickFirstName(
    user?.display_name?.trim() || user?.name || "",
  );
  const subtitle = firm?.name
    ? `${firm.name} · ${formatDate(new Date(), locale, "long")}`
    : formatDate(new Date(), locale, "long");

  const activeEngagements = engagements
    .filter(
      (e) => e.status === "sent" || e.status === "in_progress",
    )
    .slice(0, 5);
  const recentClients = [...clients].slice(0, 5);

  return (
    <div className="space-y-10 sm:space-y-12">
      {/* Hero greeting + dashboard CTA. The greeting client component
          shares its time-of-day logic with the regular dashboard
          greeting — `variant="hero"` just scales the typography up. */}
      <header className="flex flex-wrap items-end justify-between gap-6">
        <DashboardGreeting
          firstName={firstName}
          subtitle={subtitle}
          variant="hero"
        />
        <Link href="/dashboard" className="shrink-0 animate-in-up">
          <Button variant="outline" size="sm">
            <LayoutDashboard className="h-4 w-4" />
            {t("view_full_dashboard")}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </header>

      {/* Two-column body. lg+ becomes a 3/2 split (notifications
          dominates because the feed is the focal point); below lg
          everything stacks. */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* LEFT: Notifications feed */}
        <section
          aria-labelledby="home-notifications-title"
          className="lg:col-span-3 rounded-xl border border-border/80 bg-card overflow-hidden animate-in-up"
        >
          <header className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3">
            <h2
              id="home-notifications-title"
              className="text-sm font-semibold flex items-center gap-2"
            >
              <Inbox className="h-4 w-4 text-muted-foreground" aria-hidden />
              {t("notifications_title")}
            </h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {notifications.length > 0
                ? t("notifications_count", { count: notifications.length })
                : ""}
            </span>
          </header>
          {notifications.length === 0 ? (
            <NotificationsEmpty t={t} />
          ) : (
            <ol className="divide-y divide-border/60">
              {notifications.map((n) => (
                <NotificationRow key={n.id} n={n} locale={locale} t={t} />
              ))}
            </ol>
          )}
        </section>

        {/* RIGHT: search + clients + engagements widgets */}
        <div className="lg:col-span-2 space-y-6 animate-in-up">
          <HomeSearch />

          <Widget
            title={t("clients_widget_title")}
            count={clients.length}
            icon={Users}
            viewAllHref="/clients"
            viewAllLabel={t("view_all_clients")}
            empty={t("empty_clients")}
            emptyAction={{ href: "/clients", label: t("add_client") }}
          >
            {recentClients.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/clients/${c.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 group"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium block truncate">
                      {c.display_name}
                    </span>
                    {c.email && (
                      <span className="text-xs text-muted-foreground block truncate">
                        {c.email}
                      </span>
                    )}
                  </span>
                  <Badge variant="outline" className="font-normal shrink-0">
                    {c.type === "business"
                      ? t("client_type_business")
                      : t("client_type_individual")}
                  </Badge>
                </Link>
              </li>
            ))}
          </Widget>

          <Widget
            title={t("engagements_widget_title")}
            count={activeEngagements.length}
            icon={Briefcase}
            viewAllHref="/dashboard"
            viewAllLabel={t("view_all_engagements")}
            empty={t("empty_engagements")}
            emptyAction={{
              href: "/engagements/new",
              label: t("new_engagement"),
            }}
          >
            {activeEngagements.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/engagements/${e.id}`}
                  className="flex items-center justify-between gap-3 py-2.5 group"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium block truncate">
                      {e.title}
                    </span>
                    <span className="text-xs text-muted-foreground block truncate">
                      {clients.find((c) => c.id === e.client_id)
                        ?.display_name ?? "—"}
                    </span>
                  </span>
                  <ChevronRight
                    className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </Widget>
        </div>
      </div>
    </div>
  );
}

function Widget({
  title,
  count,
  icon: Icon,
  viewAllHref,
  viewAllLabel,
  empty,
  emptyAction,
  children,
}: {
  title: string;
  count: number;
  icon: LucideIcon;
  viewAllHref: string;
  viewAllLabel: string;
  empty: string;
  emptyAction: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/80 bg-card overflow-hidden">
      <header className="px-5 py-3.5 border-b border-border/60 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          {title}
          <span className="text-muted-foreground font-normal tabular-nums">
            ({count})
          </span>
        </h2>
        <Link
          href={viewAllHref}
          className="text-xs font-medium text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 transition-colors"
        >
          {viewAllLabel}
          <ChevronRight className="h-3 w-3" aria-hidden />
        </Link>
      </header>
      <div className="px-5">
        {count === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2.5 py-7 text-center text-muted-foreground">
            <p className="text-sm">{empty}</p>
            <Link
              href={emptyAction.href}
              className="text-sm font-medium text-primary hover:underline"
            >
              {emptyAction.label} →
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">{children}</ul>
        )}
      </div>
    </section>
  );
}

function NotificationsEmpty({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Home">>>;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-muted-foreground">
      <div
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary/40 text-muted-foreground/80"
        aria-hidden
      >
        <CheckCheck className="h-5 w-5" />
      </div>
      <p className="text-sm">{t("notifications_empty")}</p>
      <p className="text-xs text-muted-foreground/70 max-w-xs text-center">
        {t("notifications_empty_hint")}
      </p>
    </div>
  );
}

function NotificationRow({
  n,
  locale,
  t,
}: {
  n: HomeNotification;
  locale: "fr" | "en";
  t: Awaited<ReturnType<typeof getTranslations<"Home">>>;
}) {
  const { Icon, tone } = notificationVisual(n.kind);
  return (
    <li>
      <Link
        href={n.href}
        className="flex items-start gap-3 px-5 py-3.5 hover:bg-secondary/40 transition-colors group"
      >
        <span
          className={
            "inline-flex h-8 w-8 items-center justify-center rounded-full shrink-0 mt-0.5 " +
            tone
          }
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium leading-snug">
            {t(`kind_${n.kind}` as Parameters<typeof t>[0])}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {n.engagement_title && (
              <span className="truncate max-w-[18rem]">
                {n.engagement_title}
              </span>
            )}
            {n.client_display_name && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate max-w-[12rem]">
                  {n.client_display_name}
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{formatRelative(n.timestamp, locale)}</span>
          </div>
        </div>
        <ChevronRight
          className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors mt-2 shrink-0"
          aria-hidden
        />
      </Link>
    </li>
  );
}

function notificationVisual(kind: HomeNotification["kind"]): {
  Icon: LucideIcon;
  tone: string;
} {
  switch (kind) {
    case "ai_auto_rejected":
    case "ai_escalated_to_accountant":
      return {
        Icon: AlertTriangle,
        tone: "bg-warning/15 text-warning",
      };
    case "ai_quality_flagged":
      return {
        Icon: Sparkles,
        tone: "bg-primary/15 text-primary",
      };
    case "ready_to_review":
      return {
        Icon: CheckCheck,
        tone: "bg-success/15 text-success",
      };
    case "overdue":
      return {
        Icon: AlertTriangle,
        tone: "bg-destructive/15 text-destructive",
      };
  }
}

function pickFirstName(full: string): string | null {
  const trimmed = full.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}

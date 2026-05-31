import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { formatRelative } from "@/lib/format";
import {
  listHomeNotifications,
  type HomeNotification,
} from "@/lib/home/notifications";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ChevronRight,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Breadcrumb } from "@/components/ui/breadcrumb";

export const dynamic = "force-dynamic";

// /notifications — the full feed behind "What's new" on /inbox.
// Same aggregation function as Home (`listHomeNotifications`), just
// uncapped to 50 rows so the accountant can scroll through everything
// recent. This is the deliberate destination for "View all" on the
// Home glance — Home shows the top 5, this shows the rest.
//
// Distinct from the security audit log (/settings/audit) which is
// owner-only + shows every single activity_log row. Notifications
// is the "things you might want to do something about" subset, for
// every team member.
export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const notifications = await listHomeNotifications(50);
  const t = await getTranslations("Notifications");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  return (
    <div className="mx-auto w-full max-w-2xl px-1 pt-10 sm:pt-14 pb-16 space-y-8">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_dashboard"), href: "/dashboard" },
          { label: t("title") },
        ]}
      />

      <header className="space-y-2">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight flex items-center gap-3">
          <Bell className="h-6 w-6 text-muted-foreground" aria-hidden />
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          {t("subtitle")}
        </p>
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
    </div>
  );
}

function NotificationsEmpty({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Notifications">>>;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
      <div
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary/40 text-muted-foreground/80"
        aria-hidden
      >
        <CheckCheck className="h-5 w-5" />
      </div>
      <p className="text-sm">{t("empty")}</p>
      <p className="text-xs text-muted-foreground/70 max-w-xs text-center">
        {t("empty_hint")}
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
  t: Awaited<ReturnType<typeof getTranslations<"Notifications">>>;
}) {
  const { Icon, tone } = notificationVisual(n.kind);
  return (
    <li>
      <Link href={n.href} className="flex items-start gap-4 py-4 group">
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
                <span className="truncate max-w-[14rem]">
                  {n.client_display_name}
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{formatRelative(n.timestamp, locale)}</span>
          </div>
        </div>
        <ChevronRight
          className="h-4 w-4 text-muted-foreground/30 group-hover:text-foreground/70 transition-colors mt-2 shrink-0"
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
      return { Icon: AlertTriangle, tone: "bg-warning/15 text-warning" };
    case "ai_quality_flagged":
      return { Icon: Sparkles, tone: "bg-primary/15 text-primary" };
    case "ready_to_review":
      return { Icon: CheckCheck, tone: "bg-success/15 text-success" };
    case "overdue":
      return {
        Icon: AlertTriangle,
        tone: "bg-destructive/15 text-destructive",
      };
  }
}

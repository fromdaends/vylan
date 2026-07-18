import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { formatRelative } from "@/lib/format";
import {
  listHomeNotifications,
  type HomeNotification,
} from "@/lib/home/notifications";
import { getCurrentUser } from "@/lib/db/users";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  FileSignature,
  FileUp,
  MessageSquare,
  Sparkles,
  UserRoundCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { ClientMessageRow } from "@/components/inbox/client-message-row";

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

  // Scope per role: staff see their assigned engagements; owners firm-wide.
  const user = await getCurrentUser();
  const viewer = user
    ? { userId: user.id, isOwner: user.role === "owner" }
    : undefined;
  // Never let the feed's aggregation crash the page — degrade to empty on error.
  const notifications = await listHomeNotifications(50, viewer).catch((e) => {
    console.error("[notifications] aggregation failed:", e);
    return [];
  });
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
          {notifications.map((n) =>
            // Client messages reply IN PLACE (open the panel's thread, no
            // navigation); every other kind stays a plain link row.
            n.kind === "client_message" && n.engagement_id ? (
              <ClientMessageRow
                key={n.id}
                engagement={{
                  id: n.engagement_id,
                  title: n.engagement_title,
                  status: n.engagement_status ?? null,
                }}
                clientName={n.client_display_name}
                timestamp={n.timestamp}
                locale={locale}
                compact={false}
              />
            ) : (
              <NotificationRow key={n.id} n={n} locale={locale} t={t} />
            ),
          )}
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
          {/* Handoff note the assigner left (engagement_assigned rows only). */}
          {n.note && (
            <div className="mt-1 text-xs italic text-muted-foreground/90 line-clamp-2">
              &ldquo;{n.note}&rdquo;
            </div>
          )}
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
    case "document_uploaded":
      return { Icon: FileUp, tone: "bg-primary/15 text-primary" };
    case "signed_copy_uploaded":
      return { Icon: FileSignature, tone: "bg-primary/15 text-primary" };
    case "ready_to_review":
      return { Icon: CheckCheck, tone: "bg-success/15 text-success" };
    case "overdue":
      return {
        Icon: AlertTriangle,
        tone: "bg-destructive/15 text-destructive",
      };
    case "client_paid":
      return { Icon: Wallet, tone: "bg-success/15 text-success" };
    case "payment_failed":
      return {
        Icon: AlertTriangle,
        tone: "bg-destructive/15 text-destructive",
      };
    case "engagement_completed":
      return { Icon: CheckCircle2, tone: "bg-success/15 text-success" };
    case "client_signed":
      return { Icon: FileSignature, tone: "bg-success/15 text-success" };
    case "client_message":
      return { Icon: MessageSquare, tone: "bg-primary/15 text-primary" };
    case "engagement_assigned":
      return { Icon: UserRoundCheck, tone: "bg-primary/15 text-primary" };
  }
}

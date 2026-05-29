import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatRelative, type AppLocale } from "@/lib/format";
import type { HomeNotification } from "@/lib/home/notifications";
import {
  AlertTriangle,
  CheckCheck,
  ChevronRight,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

// "What's new" activity feed — AI flags, ready-to-review, overdue — lifted
// verbatim from the old Home page. Data comes from listHomeNotifications; this
// component just renders it. Same row formatting (icon · title · engagement +
// client · relative time); the "Home" message namespace is reused as-is.
export async function WhatsNewFeed({
  notifications,
  locale,
}: {
  notifications: HomeNotification[];
  locale: AppLocale;
}) {
  const t = await getTranslations("Home");

  return (
    <section aria-labelledby="inbox-whats-new-title" className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="inbox-whats-new-title"
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          {t("whats_new")}
        </h2>
        {notifications.length > 0 && (
          <Link
            href="/notifications"
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("view_all")}
            <ChevronRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-5 py-12 text-center text-sm text-muted-foreground">
          {t("notifications_empty")}
        </div>
      ) : (
        <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
          {notifications.map((n) => (
            <WhatsNewRow key={n.id} n={n} locale={locale} t={t} />
          ))}
        </ol>
      )}
    </section>
  );
}

function WhatsNewRow({
  n,
  locale,
  t,
}: {
  n: HomeNotification;
  locale: AppLocale;
  t: Awaited<ReturnType<typeof getTranslations<"Home">>>;
}) {
  const { Icon, tone } = notificationVisual(n.kind);
  return (
    <li>
      <Link href={n.href} className="group flex items-start gap-4 px-4 py-4">
        <span
          className={
            "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full " +
            tone
          }
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-snug">
            {t(`kind_${n.kind}` as Parameters<typeof t>[0])}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {n.engagement_title && (
              <span className="truncate max-w-[16rem]">
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
          className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-foreground/70"
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

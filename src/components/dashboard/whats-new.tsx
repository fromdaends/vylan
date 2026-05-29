"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  AlertTriangle,
  CheckCheck,
  ChevronRight,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { formatRelative, type AppLocale } from "@/lib/format";
import type { HomeNotification } from "@/lib/home/notifications";

// "What's new" — the firm's recent, actionable signals (overdue,
// ready-to-review, and AI flags), aggregated by listHomeNotifications.
// Ported from the old /home glance so retiring that page loses nothing.
export function WhatsNew({
  notifications,
  locale,
}: {
  notifications: HomeNotification[];
  locale: AppLocale;
}) {
  const t = useTranslations("Home");

  return (
    <section aria-labelledby="dash-whats-new" className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <h2
          id="dash-whats-new"
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          {t("whats_new")}
        </h2>
        {notifications.length > 0 && (
          <Link
            href="/notifications"
            className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary hover:underline"
          >
            {t("view_all")}
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 px-5 py-12 text-center text-sm text-muted-foreground">
          {t("notifications_empty")}
        </div>
      ) : (
        <ol className="overflow-hidden rounded-xl border border-border bg-card divide-y divide-border/60">
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
  t: ReturnType<typeof useTranslations<"Home">>;
}) {
  const { Icon, tone } = notificationVisual(n.kind);
  return (
    <li>
      <Link
        href={n.href}
        className="group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-secondary/30"
      >
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
              <span className="max-w-[16rem] truncate">
                {n.engagement_title}
              </span>
            )}
            {n.client_display_name && (
              <>
                <span aria-hidden>·</span>
                <span className="max-w-[12rem] truncate">
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
      return { Icon: AlertTriangle, tone: "bg-destructive/15 text-destructive" };
  }
}

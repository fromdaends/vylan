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

// "What's new" — the calm, informational activity feed in the Overview's right
// rail (AI flags, ready-to-review, overdue, …). Deliberately LIGHTER than the
// accent-tinted Needs-attention block: no hard card chrome, hairline dividers,
// small muted icon chips. It answers "what happened", not "what to do". Data
// comes from listHomeNotifications; this component just renders it.
export async function WhatsNewFeed({
  notifications,
  locale,
}: {
  notifications: HomeNotification[];
  locale: AppLocale;
}) {
  const t = await getTranslations("Home");

  // aria-label (not aria-labelledby) because this feed renders twice on the
  // Overview (mobile inline + desktop sticky rail) — a shared heading id would
  // be a duplicate-id violation. The label carries the same text.
  return (
    <section aria-label={t("whats_new")} className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
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
        <p className="text-xs text-muted-foreground">{t("whats_new_empty")}</p>
      ) : (
        <ol className="divide-y divide-border/40">
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
  const { Icon, tone, label } = notificationVisual(n.kind, t);
  return (
    <li>
      <Link
        href={n.href}
        className="group flex items-start gap-2.5 py-2.5 first:pt-0"
      >
        <span
          className={
            "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full " +
            tone
          }
        >
          <Icon className="h-3 w-3" aria-hidden />
          <span className="sr-only">{label}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs leading-snug text-foreground/90 group-hover:text-foreground">
            {t(`kind_${n.kind}` as Parameters<typeof t>[0])}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
            {n.engagement_title && (
              <span className="truncate max-w-[12rem]">
                {n.engagement_title}
              </span>
            )}
            {n.client_display_name && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate max-w-[10rem]">
                  {n.client_display_name}
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="whitespace-nowrap">
              {formatRelative(n.timestamp, locale)}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}

// Icon + tone per event kind, plus a screen-reader label describing the event
// type (the icon alone isn't announced).
function notificationVisual(
  kind: HomeNotification["kind"],
  t: Awaited<ReturnType<typeof getTranslations<"Home">>>,
): { Icon: LucideIcon; tone: string; label: string } {
  switch (kind) {
    case "ai_auto_rejected":
    case "ai_escalated_to_accountant":
      return {
        Icon: AlertTriangle,
        tone: "bg-warning/15 text-warning",
        label: t(`kind_${kind}` as Parameters<typeof t>[0]),
      };
    case "ai_quality_flagged":
      return {
        Icon: Sparkles,
        tone: "bg-primary/15 text-primary",
        label: t(`kind_${kind}` as Parameters<typeof t>[0]),
      };
    case "ready_to_review":
      return {
        Icon: CheckCheck,
        tone: "bg-success/15 text-success",
        label: t(`kind_${kind}` as Parameters<typeof t>[0]),
      };
    case "overdue":
      return {
        Icon: AlertTriangle,
        tone: "bg-destructive/15 text-destructive",
        label: t(`kind_${kind}` as Parameters<typeof t>[0]),
      };
  }
}

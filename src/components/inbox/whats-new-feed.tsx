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
// rail (AI flags, ready-to-review, overdue, …). Presented as a deliberate but
// quiet panel: a subtle neutral card (NOT the accent tint of the Needs-attention
// block), a crisp title tier + a muted metadata tier, and clearly-sized event
// icons. It answers "what happened", not "what to do" — so it stays secondary to
// the main column. Data comes from listHomeNotifications; this just renders it.
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
    <section
      aria-label={t("whats_new")}
      className="rounded-2xl border border-border/60 bg-card/50 p-4 sm:p-5"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("whats_new")}
        </h2>
        {notifications.length > 0 && (
          <Link
            href="/notifications"
            className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("view_all")}
            <ChevronRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="pt-3 text-xs text-muted-foreground">
          {t("whats_new_empty")}
        </p>
      ) : (
        <ol className="mt-1 divide-y divide-border/50">
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
      <Link href={n.href} className="group flex items-start gap-3 py-3">
        <span
          className={
            "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full " +
            tone
          }
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {/* Crisp, full-contrast title tier (the event). */}
          <div className="text-[13px] font-medium leading-snug text-foreground">
            {t(`kind_${n.kind}` as Parameters<typeof t>[0])}
          </div>
          {/* Muted second tier: engagement · client · when. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
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
        <ChevronRight
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-foreground/60"
          aria-hidden
        />
      </Link>
    </li>
  );
}

// Icon + tone chip per event kind. The visible title states the event, so the
// icon is decorative (aria-hidden) — no separate screen-reader label needed.
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

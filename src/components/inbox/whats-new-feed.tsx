import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatRelative, type AppLocale } from "@/lib/format";
import type { HomeNotification } from "@/lib/home/notifications";
import {
  AlertTriangle,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  FileSignature,
  FileUp,
  MessageSquare,
  Reply,
  Sparkles,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// "What's new" — the calm, informational activity feed (AI flags, ready-to-
// review, overdue, …) with a crisp title tier, a muted metadata tier, and
// clearly-sized event icons. It answers "what happened", not "what to do".
// The Overview's permanent right rail is gone: these rows are server-rendered
// and passed as children into the bell-anchored popover (WhatsNewBell),
// which owns the title/count/View-all chrome. Data comes from
// listHomeNotifications; this just renders it.
export async function WhatsNewFeed({
  notifications,
  locale,
}: {
  notifications: HomeNotification[];
  locale: AppLocale;
}) {
  const t = await getTranslations("Home");

  if (notifications.length === 0) {
    return (
      <p className="py-3 text-sm text-muted-foreground">
        {t("whats_new_empty")}
      </p>
    );
  }

  return (
    <ol className="divide-y divide-border/50">
      {notifications.map((n) => (
        <WhatsNewRow key={n.id} n={n} locale={locale} t={t} />
      ))}
    </ol>
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
      <Link
        href={n.href}
        className="group flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-secondary/40"
      >
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
          {/* A client message gets a Reply affordance — the whole row already
              links straight into the panel's Client-messages tab, this chip
              just makes the action explicit. A span, not a nested link. */}
          {n.kind === "client_message" && (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-xs font-medium text-foreground transition-colors group-hover:border-border group-hover:bg-secondary/60">
              <Reply className="h-3 w-3" aria-hidden />
              {t("reply")}
            </span>
          )}
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
    case "document_uploaded":
      return { Icon: FileUp, tone: "bg-primary/15 text-primary" };
    case "signed_copy_uploaded":
      return { Icon: FileSignature, tone: "bg-primary/15 text-primary" };
    case "ready_to_review":
      return { Icon: CheckCheck, tone: "bg-success/15 text-success" };
    case "overdue":
      return { Icon: AlertTriangle, tone: "bg-destructive/15 text-destructive" };
    case "client_paid":
      return { Icon: Wallet, tone: "bg-success/15 text-success" };
    case "payment_failed":
      return { Icon: AlertTriangle, tone: "bg-destructive/15 text-destructive" };
    case "engagement_completed":
      return { Icon: CheckCircle2, tone: "bg-success/15 text-success" };
    case "client_signed":
      return { Icon: FileSignature, tone: "bg-success/15 text-success" };
    case "client_message":
      return { Icon: MessageSquare, tone: "bg-primary/15 text-primary" };
  }
}

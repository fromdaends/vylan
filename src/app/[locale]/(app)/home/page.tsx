import { getTranslations, setRequestLocale } from "next-intl/server";
import { getCurrentFirm } from "@/lib/db/firms";
import { getCurrentUser } from "@/lib/db/users";
import { listClients } from "@/lib/db/clients";
import { listEngagements } from "@/lib/db/engagements";
import { Link } from "@/i18n/navigation";
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
  CheckCheck,
  ChevronRight,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export const dynamic = "force-dynamic";

// Home — the post-login glance. Minimal, ChatGPT-style centered
// column: greeting → search → "What's new" → small quick-links row.
// Detail lives on /dashboard; this page is the calm entry point.
export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  // 5 most-recent notifications is enough on a glance surface — anyone
  // who wants more goes to /dashboard.
  const [firm, user, clients, engagements, notifications] = await Promise.all([
    getCurrentFirm(),
    getCurrentUser(),
    listClients({ includeArchived: false }),
    listEngagements(),
    listHomeNotifications(5),
  ]);

  const t = await getTranslations("Home");

  const firstName = pickFirstName(
    user?.display_name?.trim() || user?.name || "",
  );
  const subtitle = firm?.name
    ? `${firm.name} · ${formatDate(new Date(), locale, "long")}`
    : formatDate(new Date(), locale, "long");

  const activeCount = engagements.filter(
    (e) => e.status === "sent" || e.status === "in_progress",
  ).length;

  return (
    <div className="mx-auto w-full max-w-2xl px-1 pt-16 sm:pt-24 pb-16 space-y-14 sm:space-y-16">
      {/* 1. Greeting — centered, large, given real breathing room
          above it via the wrapper's pt-16/24. The hero variant of
          the greeting handles the typography scale. */}
      <div className="text-center">
        <DashboardGreeting
          firstName={firstName}
          subtitle={subtitle}
          variant="hero"
        />
      </div>

      {/* 2. Search — the visual anchor. Centered, prominent, pill-
          shaped, sits directly under the greeting. */}
      <HomeSearch />

      {/* 3. What's new — minimal scannable feed. No card border on
          the section itself; rows are separated by a single hairline
          divider so the whole block reads as one quiet list. */}
      <section aria-labelledby="home-whats-new-title" className="space-y-4">
        <header className="flex items-baseline justify-between gap-3">
          <h2
            id="home-whats-new-title"
            className="text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground"
          >
            {t("whats_new")}
          </h2>
          {notifications.length > 0 && (
            <Link
              href="/dashboard#ai-activity"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-0.5"
            >
              {t("view_all")}
              <ChevronRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </header>
        {notifications.length === 0 ? (
          <WhatsNewEmpty t={t} />
        ) : (
          <ol className="divide-y divide-border/60">
            {notifications.map((n) => (
              <WhatsNewRow key={n.id} n={n} locale={locale} t={t} />
            ))}
          </ol>
        )}
      </section>

      {/* 4. Quick-links footer — understated row of secondary
          shortcuts. Compact, low visual weight, separated by thin
          dots. Wraps on very narrow viewports. */}
      <nav
        aria-label={t("quick_links_label")}
        className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground pt-4 border-t border-border/40"
      >
        <Link
          href="/clients"
          className="hover:text-foreground transition-colors"
        >
          {t("quick_clients")}
          <span className="ml-1.5 font-mono tabular-nums text-muted-foreground/70">
            ({clients.length})
          </span>
        </Link>
        <span className="text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <Link
          href="/dashboard"
          className="hover:text-foreground transition-colors"
        >
          {t("quick_engagements")}
          <span className="ml-1.5 font-mono tabular-nums text-muted-foreground/70">
            ({activeCount})
          </span>
        </Link>
        <span className="text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <Link
          href="/dashboard"
          className="hover:text-foreground transition-colors"
        >
          {t("quick_dashboard")}
        </Link>
      </nav>
    </div>
  );
}

function WhatsNewEmpty({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations<"Home">>>;
}) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-muted-foreground">
        {t("notifications_empty")}
      </p>
    </div>
  );
}

function WhatsNewRow({
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
      <Link href={n.href} className="flex items-start gap-4 py-4 group">
        <span
          className={
            "inline-flex h-7 w-7 items-center justify-center rounded-full shrink-0 mt-0.5 " +
            tone
          }
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm leading-snug">
            {t(`kind_${n.kind}` as Parameters<typeof t>[0])}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
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

function pickFirstName(full: string): string | null {
  const trimmed = full.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] || null;
}

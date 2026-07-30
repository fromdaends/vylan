import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link, getPathname } from "@/i18n/navigation";
import { assertLocale } from "@/lib/locale";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/db/users";
import { getCurrentFirm } from "@/lib/db/firms";
import { Bell, CheckCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { listFeed, groupByDay, unreadCount } from "@/lib/notifications/feed";
import { NotificationRow } from "@/components/notifications/notification-row";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

// /notifications — the full feed behind the header bell.
//
// Reads the stored `notifications` table (migration 0920), so every row here
// carries real read state and can be marked unread or deleted. Distinct from
// the activity log at /settings/audit, which shows every activity_log row the
// viewer is allowed to see; this is "things addressed to you".
export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const { locale: rawLocale } = await params;
  const { filter, page: pageParam } = await searchParams;
  const locale = assertLocale(rawLocale);
  setRequestLocale(locale);

  const user = await getCurrentUser();
  if (!user) {
    redirect(getPathname({ locale, href: "/login" }));
  }

  const unreadOnly = filter === "unread";
  const page = Math.max(1, Number(pageParam) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const supabase = await getServerSupabase();
  const [firm, items, unread] = await Promise.all([
    getCurrentFirm(),
    // One extra row tells us whether a next page exists without a count query.
    listFeed(supabase, {
      userId: user.id,
      limit: PAGE_SIZE + 1,
      offset,
      unreadOnly,
    }),
    unreadCount(supabase, user.id),
  ]);

  const hasNext = items.length > PAGE_SIZE;
  const pageItems = hasNext ? items.slice(0, PAGE_SIZE) : items;
  const timezone = firm?.timezone ?? "America/Toronto";
  const groups = groupByDay(pageItems, timezone);
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const t = await getTranslations("Notifications");
  const tApp = await getTranslations("App");
  const tCommon = await getTranslations("Common");

  return (
    <div className="mx-auto w-full max-w-2xl px-1 pb-16 pt-10 sm:pt-14">
      <Breadcrumb
        label={tCommon("breadcrumb")}
        items={[
          { label: tApp("nav_dashboard"), href: "/dashboard" },
          { label: t("page_title") },
        ]}
      />

      <header className="mt-8 space-y-2">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          <Bell className="h-6 w-6 text-muted-foreground" aria-hidden />
          {t("page_title")}
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          {t("page_subtitle")}
        </p>
      </header>

      <div className="mt-6 flex items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-1">
          <FilterTab
            href="/notifications"
            active={!unreadOnly}
            label={t("filter_all")}
          />
          <FilterTab
            href="/notifications?filter=unread"
            active={unreadOnly}
            label={`${t("filter_unread")}${unread > 0 ? ` (${unread})` : ""}`}
          />
        </div>
        {unread > 0 && <MarkAllReadButton label={t("mark_all_read")} />}
      </div>

      {pageItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
          <div
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary/40 text-muted-foreground/80"
            aria-hidden
          >
            <CheckCheck className="h-5 w-5" />
          </div>
          <p className="text-sm">{unreadOnly ? t("empty_unread") : t("empty")}</p>
          {!unreadOnly && (
            <p className="max-w-xs text-center text-xs text-muted-foreground/70">
              {t("empty_hint")}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2">
          {groups.map((group) => (
            <section key={group.day}>
              <h2 className="px-2 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                {group.day === todayKey
                  ? t("day_today")
                  : new Intl.DateTimeFormat(locale, {
                      timeZone: timezone,
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    }).format(new Date(group.items[0].createdAt))}
              </h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <NotificationRow item={item} locale={locale} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {(page > 1 || hasNext) && (
        <nav
          className="mt-8 flex items-center justify-between border-t border-border/60 pt-4"
          aria-label={t("page_title")}
        >
          <PageLink
            href={pageHref(unreadOnly, page - 1)}
            disabled={page <= 1}
            label={tCommon("back")}
            direction="prev"
          />
          <PageLink
            href={pageHref(unreadOnly, page + 1)}
            disabled={!hasNext}
            label={tCommon("next")}
            direction="next"
          />
        </nav>
      )}
    </div>
  );
}

function pageHref(unreadOnly: boolean, page: number): string {
  const parts: string[] = [];
  if (unreadOnly) parts.push("filter=unread");
  if (page > 1) parts.push(`page=${page}`);
  return parts.length ? `/notifications?${parts.join("&")}` : "/notifications";
}

function FilterTab({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-lg px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

function PageLink({
  href,
  disabled,
  label,
  direction,
}: {
  href: string;
  disabled: boolean;
  label: string;
  direction: "prev" | "next";
}) {
  const content = (
    <>
      {direction === "prev" && <ChevronLeft className="h-4 w-4" aria-hidden />}
      {label}
      {direction === "next" && <ChevronRight className="h-4 w-4" aria-hidden />}
    </>
  );
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground/40">
        {content}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary"
    >
      {content}
    </Link>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NotificationRow } from "./notification-row";
import { markAllNotificationsReadAction } from "@/app/actions/notifications";
import { groupByDay, type FeedItem } from "@/lib/notifications/feed";
import type { AppLocale } from "@/lib/format";
import { cn } from "@/lib/cn";

// Poll cadence. Matches the existing cross-client message inbox (10s) rather
// than the 4s thread poll: the badge is ambient, not a live conversation, and
// every open tab pays for this.
const POLL_MS = 10_000;
// The badge caps at 9+ (spec). Past that the exact number tells you nothing you
// would act on differently.
const BADGE_CAP = 9;
const POPOVER_LIMIT = 20;

export function NotificationBell({
  locale,
  timezone,
  initialItems,
  initialUnread,
}: {
  locale: AppLocale;
  // The viewer's own zone, so "Today" means their today.
  timezone: string;
  initialItems: FeedItem[];
  initialUnread: number;
}) {
  const t = useTranslations("Notifications");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [unread, setUnread] = useState(initialUnread);

  const refresh = useCallback(
    async (withList: boolean) => {
      try {
        const res = await fetch(
          withList
            ? `/api/notifications?limit=${POPOVER_LIMIT}`
            : "/api/notifications?countOnly=1",
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          items?: FeedItem[];
          unread: number;
        };
        setUnread(data.unread);
        if (withList && data.items) setItems(data.items);
      } catch {
        // A failed poll is not worth surfacing — the next one is 10s away.
      }
    },
    [],
  );

  // Poll only while the tab is actually in front. A backgrounded tab polling
  // forever is the thing that makes an app feel heavy, and the existing
  // messaging polls already follow this rule.
  useEffect(() => {
    if (typeof document === "undefined") return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (!document.hidden) void refresh(false);
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void refresh(false);
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // Opening the popover pulls a fresh list — the badge poll only fetches the
  // count, so the list could otherwise be up to 10s stale at the moment it
  // becomes visible. Done in the open HANDLER rather than an effect on `open`:
  // opening is an event, and fetching from an effect body triggers a cascading
  // render (and trips the repo's react-hooks/set-state-in-effect rule).
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) void refresh(true);
    },
    [refresh],
  );

  // Optimistic local edits from a row's menu.
  const onChanged = useCallback(
    (id: string, change: "read" | "unread" | "deleted") => {
      setItems((prev) => {
        if (change === "deleted") return prev.filter((i) => i.id !== id);
        return prev.map((i) =>
          i.id === id
            ? { ...i, readAt: change === "read" ? new Date().toISOString() : null }
            : i,
        );
      });
      setUnread((prev) => {
        const target = items.find((i) => i.id === id);
        if (!target) return prev;
        const wasUnread = target.readAt === null;
        if (change === "read" && wasUnread) return Math.max(0, prev - 1);
        if (change === "unread" && !wasUnread) return prev + 1;
        if (change === "deleted" && wasUnread) return Math.max(0, prev - 1);
        return prev;
      });
    },
    [items],
  );

  const groups = groupByDay(items, timezone);
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative"
          aria-label={t("settings_title")}
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none tabular-nums text-primary-foreground"
            >
              {unread > BADGE_CAP ? `${BADGE_CAP}+` : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={10}
        className="w-[calc(100vw-2rem)] max-w-md overflow-hidden rounded-xl border-border/70 bg-popover p-0 shadow-2xl"
        // Bubble phase, deliberately NOT capture: a capture-phase close
        // unmounts the content mid-dispatch, so the clicked row's own handler
        // never fires. Same reasoning as the old What's-new popover.
        onClick={(e) => {
          const el = e.target as HTMLElement;
          // The row's own ⋯ menu and the context menu live inside this
          // popover; closing on those would make them unusable.
          if (el.closest("[data-radix-menu-content]")) return;
          if (el.closest("a")) setOpen(false);
        }}
      >
        <div className="flex h-12 items-center justify-between gap-3 border-b border-border/70 px-3">
          <div className="flex min-w-0 items-baseline gap-1.5 pl-1">
            <h2 className="truncate text-sm font-semibold tracking-tight">
              {t("settings_title")}
            </h2>
            {unread > 0 && (
              <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-secondary px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {unread}
              </span>
            )}
          </div>
          {unread > 0 && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              onClick={async () => {
                const previous = items;
                const stamp = new Date().toISOString();
                setItems((prev) =>
                  prev.map((i) => ({ ...i, readAt: i.readAt ?? stamp })),
                );
                setUnread(0);
                const res = await markAllNotificationsReadAction();
                if (!res.ok) {
                  setItems(previous);
                  void refresh(true);
                }
              }}
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              {t("mark_all_read")}
            </button>
          )}
        </div>

        <div className="max-h-[min(70vh,38rem)] overflow-y-auto overscroll-contain p-1">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
              <CheckCheck
                className="h-5 w-5 text-muted-foreground/70"
                aria-hidden
              />
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
              <p className="max-w-[16rem] text-xs text-muted-foreground/70">
                {t("empty_hint")}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.day}>
                <div
                  className={cn(
                    "px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70",
                  )}
                >
                  {group.day === todayKey
                    ? t("day_today")
                    : new Intl.DateTimeFormat(locale, {
                        timeZone: timezone,
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                      }).format(new Date(group.items[0].createdAt))}
                </div>
                {group.items.map((item) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    locale={locale}
                    compact
                    onChanged={onChanged}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border/70 p-1">
          <Link
            href="/notifications"
            className="block rounded-lg px-3 py-2 text-center text-sm font-medium text-primary transition-colors hover:bg-secondary"
          >
            {t("view_all")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

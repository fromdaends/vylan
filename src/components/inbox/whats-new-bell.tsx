"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Bell, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// YouTube-style notification popover: compact, anchored beneath the bell, and
// scrollable without covering the dashboard. Feed rows are server-rendered and
// passed as children; this client shell only owns open/close. There is no
// read/unread tracking — the badge is the recent-event count.
export function WhatsNewBell({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const t = useTranslations("Home");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative"
          aria-label={t("whats_new_bell_label", { count })}
        >
          <Bell className="h-4 w-4" aria-hidden />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none tabular-nums text-primary-foreground"
            >
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={10}
        aria-label={t("whats_new")}
        className="w-[calc(100vw-2rem)] max-w-md overflow-hidden rounded-xl border-border/70 bg-popover p-0 shadow-2xl"
        // Any link inside (a feed row, View all) navigates away — close the
        // panel right away so it doesn't linger over the route transition.
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        {/* Compact header + full-width divider, matching the reference. */}
        <div className="flex h-12 items-center justify-between gap-3 border-b border-border/70 px-4">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <h2 className="truncate text-sm font-semibold tracking-tight">
              {t("whats_new")}
            </h2>
            {count > 0 && (
              <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-secondary px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </div>
          {count > 0 && (
            <Link
              href="/notifications"
              className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("view_all")}
              <ChevronRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </div>

        {/* The server-rendered feed rows (or empty state). */}
        <div className="max-h-[min(65vh,32rem)] overflow-y-auto px-2 py-1">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

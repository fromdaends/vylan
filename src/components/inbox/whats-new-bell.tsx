"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Bell, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// Bell-summoned "What's new" panel. The Overview no longer pins the activity
// feed in a permanent right rail — a bell with a recent-events count badge
// sits with the header actions and slides the same feed in from the right
// edge over a dimmed backdrop (the same Sheet pattern as the Help panel).
// The feed rows are server-rendered and passed in as children; this shell
// only owns open/close. There is no read/unread tracking — the badge is
// simply the count of recent events (capped upstream), deliberately simple.
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
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
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
      </SheetTrigger>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="w-full gap-0 border-l border-border/60 sm:max-w-md"
        // Any link inside (a feed row, View all) navigates away — close the
        // panel right away so it doesn't linger over the route transition.
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        {/* Header: title + count left, View all right (kept clear of the X). */}
        <div className="flex items-baseline justify-between gap-3 border-b border-border/50 py-4 pl-5 pr-12">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <SheetTitle className="truncate text-sm font-semibold tracking-tight">
              {t("whats_new")}
            </SheetTitle>
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
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

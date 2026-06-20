"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// The engagement Activity feed lives in a right-side slide-out (the same Sheet
// drawer the Overview "What's new" panel uses), summoned by a History-icon
// "Activity" button in the engagement header actions. Deliberately NOT a bell:
// the bell pattern means "alerts / what's new", while this is a history log, so
// a clock/history icon keeps the two patterns distinct.
//
// The feed itself (ActivityTimeline) is passed in as children and rendered
// untouched, so its events read byte-identically to the old pinned rail. The
// feed's own "Activity" heading is the visible panel title; a screen-reader-only
// SheetTitle satisfies the dialog a11y contract without a duplicate heading.
// The Sheet brings the dimmed backdrop, the built-in close X, click-outside,
// and Esc for free.
export function ActivityDrawer({ children }: { children: ReactNode }) {
  const t = useTranslations("Activity");
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <History className="size-4" aria-hidden />
          {t("title")}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        className="w-full gap-0 border-l border-border/60 sm:max-w-md"
      >
        <SheetTitle className="sr-only">{t("title")}</SheetTitle>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

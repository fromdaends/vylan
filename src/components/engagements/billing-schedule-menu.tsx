"use client";

// Stop, pause or resume an ongoing billing arrangement.
//
// ── WHY IT IS A "..." AND NOT A BUTTON ─────────────────────────────────────
//
// The founder, more than once: they dislike big buttons and loud text sitting
// on a main screen, and controls belong on the object they act on rather than
// gathered somewhere central. So this is the quietest thing that can still be
// found — a "..." on the billing group's own header, beside the frequency it
// controls, showing nothing at all until there is a schedule to act on.
//
// ── WHY IT EXISTS AT ALL ───────────────────────────────────────────────────
//
// A "$400/month" line started billing for real and there was no way anywhere in
// the product to stop it. The only exits were deleting the engagement or
// archiving the client, neither of which is called "stop billing". A recurring
// charge you cannot switch off is worse than one that never ran.

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  endBillingScheduleAction,
  pauseBillingScheduleAction,
  resumeBillingScheduleAction,
} from "@/app/actions/billing-schedules";

export function BillingScheduleMenu({
  scheduleId,
  status,
}: {
  scheduleId: string;
  status: "active" | "paused" | "ended";
}) {
  const t = useTranslations("Engagements");
  const [pending, startTransition] = useTransition();
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  // Ended is final, so there is nothing to offer — and an "..." that opens a
  // menu of things you cannot do is furniture shaped like a way forward.
  if (status === "ended") return null;

  function run(action: (id: string) => Promise<{ ok: boolean }>) {
    startTransition(async () => {
      await action(scheduleId);
      setConfirmingEnd(false);
    });
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // Reopening must not land on a primed confirm from last time.
        if (!open) setConfirmingEnd(false);
      }}
    >
      <DropdownMenuTrigger
        aria-label={t("services_billing_menu")}
        disabled={pending}
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <MoreHorizontal className="size-4" aria-hidden />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        {status === "active" ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              run(pauseBillingScheduleAction);
            }}
          >
            {t("services_billing_pause")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              run(resumeBillingScheduleAction);
            }}
          >
            {t("services_billing_resume")}
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/* Ending is irreversible, so it asks twice — in place, rather than in a
            dialog, because the second click is the whole confirmation and a
            modal for it would be heavier than the action. */}
        {confirmingEnd ? (
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              run(endBillingScheduleAction);
            }}
          >
            {t("services_billing_end_confirm")}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmingEnd(true);
            }}
          >
            {t("services_billing_end")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

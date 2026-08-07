"use client";

// THE PIN — one component, both surfaces (the Firms table row and the firm
// detail header). Cohesion rule's smallest useful unit: the day these were
// written they would look identical, and the day someone restyles one they
// would not.
//
// ── OPTIMISTIC, BUT HONEST ABOUT FAILURE ───────────────────────────────────
//
// The icon flips the moment you click it, because waiting ~400ms for a round
// trip to fill in a star feels broken. If the write then fails it flips BACK
// and says so — a pin that looks set and is not is exactly the "verify the
// effect, not the toast" trap: the founder would come back tomorrow expecting a
// watchlist and find an empty one.
//
// ── IT DOES NOT RENDER AT ALL WHEN 1810 IS UNAPPLIED ───────────────────────
//
// The caller passes `available={data.pinsAvailable}`. False ⇒ no button. A
// disabled star with a tooltip explaining a migration is a dead control that
// makes the founder feel the product is broken; absence just reads as "this
// screen doesn't have that".

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { toggleFirmPinAction } from "@/app/actions/founder-pins";

export function PinButton({
  firmId,
  firmName,
  pinned,
  available,
  size = "sm",
}: {
  firmId: string;
  firmName: string;
  pinned: boolean;
  available: boolean;
  /** "sm" is the table row; "md" sits beside a page title. */
  size?: "sm" | "md";
}) {
  const t = useTranslations("Founders");
  const [isPinned, setIsPinned] = useState(pinned);
  const [pending, startTransition] = useTransition();

  if (!available) return null;

  const label = isPinned
    ? t("pin_remove", { name: firmName })
    : t("pin_add", { name: firmName });

  function onClick() {
    const next = !isPinned;
    setIsPinned(next); // optimistic
    startTransition(async () => {
      const result = await toggleFirmPinAction(firmId, next);
      if (result.ok) {
        // Trust the SERVER's answer, not the guess — an idempotent write can
        // legitimately disagree with the optimistic flip if the other founder
        // clicked the same row a second earlier.
        setIsPinned(result.pinned === true);
        return;
      }
      setIsPinned(!next); // roll back
      toast.error(result.needsMigration ? t("pin_needs_migration") : t("pin_failed"));
    });
  }

  const Icon = isPinned ? Pin : PinOff;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={isPinned}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        size === "sm" ? "size-6" : "size-8",
        isPinned
          ? "text-accent hover:text-accent/80"
          : // Unpinned is nearly invisible until you hover the row — the
            // founder's standing preference for hiding controls that are not
            // doing anything. `group-hover` is on the row; opacity-100 on focus
            // keeps it reachable by keyboard.
            "text-muted-foreground/40 opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
    </button>
  );
}

"use client";

// Floating bottom-right prompt on a recurring engagement whose setup has
// drifted from its series: "Apply to future occurrences?" — one click
// promotes this engagement's current checklist / reminders / invoice to the
// series (the same refreshSeriesSnapshotAction the Repeat dialog uses).
//
// Only rendered when the server computed a real difference, so it never nags
// idly; "Not now" hides it for this tab session (sessionStorage), and a
// successful apply removes the difference itself.

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Loader2, Repeat, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshSeriesSnapshotAction } from "@/app/actions/recurring";

export function SeriesSyncPrompt({
  seriesId,
  engagementId,
}: {
  seriesId: string;
  engagementId: string;
}) {
  const t = useTranslations("Engagements");
  const router = useRouter();
  const [applied, setApplied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [closedNow, setClosedNow] = useState(false);
  const [pending, startTransition] = useTransition();
  const storageKey = `vylan:series-sync-dismissed:${seriesId}`;

  // Hydration-safe sessionStorage read: hidden during SSR (server snapshot),
  // real value after hydration — without a setState-in-effect. Same-tab
  // dismissal is covered by `closedNow` (set in the click handler), so no
  // storage-event subscription is needed.
  const storedDismissed = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return window.sessionStorage.getItem(storageKey) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
  const dismissed = storedDismissed || closedNow;

  function dismiss() {
    setClosedNow(true);
    try {
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Storage blocked — the dismissal just won't persist across reloads.
    }
  }

  function apply() {
    setFailed(false);
    startTransition(async () => {
      const result = await refreshSeriesSnapshotAction({
        seriesId,
        engagementId,
      });
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setApplied(true);
      // After the refresh the server recomputes the diff as "in sync" and
      // stops rendering this prompt; the brief "Applied" state bridges the
      // refresh round-trip.
      router.refresh();
    });
  }

  if (dismissed) return null;

  return (
    // bottom-28: the bottom-right corner is already occupied — the Chats FAB
    // sits at the corner and sonner toasts pop just above it. This card
    // parks ABOVE that whole zone so a "Checklist item added" toast (the very
    // action that usually summons this prompt) can never cover it.
    // Finish: soft-glass card — larger radius, translucent bg with backdrop
    // blur, crisp elevated shadow. Tokens only, correct in both themes.
    <div className="fixed bottom-28 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card/90 p-4 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-300">
      {applied ? (
        <p className="flex items-center gap-2 text-sm">
          <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {t("repeat_sync_applied")}
        </p>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <Repeat
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              {t("repeat_sync_title")}
            </p>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("repeat_sync_dismiss")}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("repeat_sync_body")}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" size="sm" onClick={apply} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Repeat className="size-4" />
              )}
              {t("repeat_sync_apply")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismiss}
              disabled={pending}
            >
              {t("repeat_sync_dismiss")}
            </Button>
          </div>
          {failed && (
            <p className="mt-2 text-xs text-destructive">
              {t("repeat_control_error")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  ActivityTimeline,
  type TimelineEntry,
} from "@/components/engagements/activity-timeline";
import type { AppLocale } from "@/lib/format";

type ActivityPayload = {
  entries: TimelineEntry[];
  filenames: Record<string, string>;
  rejectionReasons: Record<string, string | null>;
};

// The last successful load, tagged with the engagement it belongs to so a
// switch to another engagement renders the skeleton instead of stale rows.
type Loaded = {
  engagementId: string;
  payload: ActivityPayload;
};

// Refresh cadence while the tab is visible. The engagement page itself polls
// every 5s (AutoRefresh); the panel is a secondary surface so it can be a
// little lazier and still feel live.
const REFRESH_MS = 15_000;

// The Assistant panel's Activity tab: the engagement activity feed, relocated
// from the old header slide-out. Data comes from GET /api/engagement-chat/
// activity (same listActivityForEngagement query + live filename/reason
// lookups the old server-rendered feed used).
export function ActivityTab({
  engagementId,
  locale,
  active,
}: {
  engagementId: string | null;
  locale: AppLocale;
  // Panel open AND this tab selected — gates fetching + polling so a closed
  // panel costs nothing.
  active: boolean;
}) {
  const t = useTranslations("Assistant");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // The engagement id whose initial load failed — clears on retry/switch.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isLoaded = loaded !== null && loaded.engagementId === engagementId;
  const failed = failedFor !== null && failedFor === engagementId;

  const load = useCallback(async (id: string, silent: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(
        `/api/engagement-chat/activity?engagementId=${encodeURIComponent(id)}`,
        { signal: controller.signal },
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as ActivityPayload;
      setLoaded({ engagementId: id, payload: body });
      setFailedFor(null);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      // A failed quiet refresh keeps showing the last good feed; only a
      // failed initial load surfaces the error state.
      if (!silent) setFailedFor(id);
    }
  }, []);

  // Initial load + reload on engagement switch. State writes land in the
  // fetch continuation inside load(), never synchronously — the disable
  // matches the repo's fetch-on-mount idiom (see quickbooks-lists.tsx).
  useEffect(() => {
    if (!active || !engagementId || isLoaded || failed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(engagementId, false);
  }, [active, engagementId, isLoaded, failed, load]);

  // Quiet refresh while the tab stays open and the browser tab is visible.
  useEffect(() => {
    if (!active || !engagementId || !isLoaded) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load(engagementId, true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, engagementId, isLoaded, load]);

  // Abort any in-flight fetch on unmount.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (!engagementId) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
        {t("no_engagement_selected")}
      </p>
    );
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-8">
        <p className="text-sm text-muted-foreground">{t("activity_error")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          // Clearing the failure re-arms the load effect above.
          onClick={() => setFailedFor(null)}
        >
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (!isLoaded) {
    // Simple pulse skeleton — three placeholder rows shaped like timeline
    // entries so the switch to real content doesn't jump.
    return (
      <div className="space-y-4 px-5 py-5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3 animate-pulse">
            <span className="mt-1.5 size-2 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 rounded bg-muted w-3/4" />
              <div className="h-3 rounded bg-muted w-2/5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="px-5 py-5">
      <ActivityTimeline
        entries={loaded.payload.entries}
        locale={locale}
        filenamesByFileId={loaded.payload.filenames}
        rejectionReasonsByItemId={loaded.payload.rejectionReasons}
      />
    </div>
  );
}

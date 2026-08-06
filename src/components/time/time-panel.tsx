"use client";

// The Time surface — ONE component for every place a client's hours appear.
//
// The engagement page's Time tab and the client profile's Time panel are the
// same concept (this client's logged time, and the two ways to add more), so
// they are the same component with the page deciding only the cut of entries
// it passes — the cohesion rule's whole point. A header with the total and the
// two actions, then the list, then an explainer when there is nothing yet.
//
// HOURS ONLY. The entries type carries no dollar field (see
// time-entries-list.tsx) and the total is a duration, not a cost.

import { useTranslations } from "next-intl";
import { StartTimerButton, LogTimeButton, type TimeContext } from "@/components/time/time-actions";
import {
  TimeEntriesList,
  type TimeListEntry,
} from "@/components/time/time-entries-list";
import { formatMinutes } from "@/lib/time/duration";
import type { AppLocale } from "@/lib/format";

export function TimePanel({
  entries,
  members,
  currentUserId,
  canManage,
  locale,
  context,
  showEngagement = false,
}: {
  entries: TimeListEntry[];
  members: { id: string; name: string }[];
  currentUserId: string;
  canManage: boolean;
  locale: AppLocale;
  context: TimeContext;
  showEngagement?: boolean;
}) {
  const t = useTranslations("Time");
  const total = entries.reduce((sum, e) => sum + e.durationMinutes, 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {total > 0 ? t("total_logged", { duration: formatMinutes(total) }) : ""}
        </p>
        <div className="flex items-center gap-2">
          <LogTimeButton context={context} />
          <StartTimerButton context={context} />
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("list_empty")}
        </p>
      ) : (
        <TimeEntriesList
          entries={entries}
          members={members}
          currentUserId={currentUserId}
          canManage={canManage}
          locale={locale}
          showEngagement={showEngagement}
        />
      )}
    </section>
  );
}

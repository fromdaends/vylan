"use client";

// The "New message from your client" notification row. Unlike every other
// feed row (a Link to the engagement), this one navigates NOWHERE: clicking
// it (or its Reply chip) pops the assistant panel open in place, scoped to
// the message's engagement, on the Client-messages tab (founder call — the
// reply box is the destination, not the engagement page).

import { useTranslations } from "next-intl";
import { MessageSquare, Reply } from "lucide-react";
import { formatRelative, type AppLocale } from "@/lib/format";
import { openAssistantForEngagement } from "@/components/assistant/assistant-store";

export function ClientMessageRow({
  engagement,
  clientName,
  timestamp,
  locale,
  // The bell popover uses the compact styling; /notifications the larger one.
  compact,
}: {
  engagement: {
    id: string;
    title: string | null;
    status: string | null;
  };
  clientName: string | null;
  timestamp: string;
  locale: AppLocale;
  compact: boolean;
}) {
  const t = useTranslations(compact ? "Home" : "Notifications");

  function openThread() {
    openAssistantForEngagement(
      {
        id: engagement.id,
        title: engagement.title ?? "",
        // Unknown status (e.g. a since-deleted engagement) falls back to a
        // writable one — the server refuses writes it shouldn't take anyway.
        status: engagement.status ?? "in_progress",
        clientName,
      },
      "messages",
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={openThread}
        className={
          compact
            ? "group flex w-full cursor-pointer items-start gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-secondary/40"
            : "group flex w-full cursor-pointer items-start gap-4 py-4 text-left"
        }
      >
        <span
          className={
            (compact
              ? "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full "
              : "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ") +
            "bg-primary/15 text-primary"
          }
          aria-hidden
        >
          <MessageSquare className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </span>
        <div className="min-w-0 flex-1">
          <div
            className={
              compact
                ? "text-[13px] font-medium leading-snug text-foreground"
                : "text-sm font-medium leading-snug"
            }
          >
            {t("kind_client_message")}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            {engagement.title && (
              <span className="truncate max-w-[12rem]">{engagement.title}</span>
            )}
            {clientName && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate max-w-[10rem]">{clientName}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="whitespace-nowrap">
              {formatRelative(timestamp, locale)}
            </span>
          </div>
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-xs font-medium text-foreground transition-colors group-hover:border-border group-hover:bg-secondary/60">
            <Reply className="h-3 w-3" aria-hidden />
            {t("reply")}
          </span>
        </div>
      </button>
    </li>
  );
}

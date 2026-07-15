"use client";

// The panel's "Client messages" tab (founder restructure): the HUMAN
// accountant<->client thread, hosted inside the assistant panel next to the
// AI chat, but unmistakably distinct — its own labeled tab, the client's name
// in the thread header, human avatars, and a "your client sees these"
// caption. The AI can never write here; only people can.
//
// Thin host around EngagementMessages: keyed by engagement so switching the
// panel's engagement remounts a fresh thread. The thread component fetches +
// stamps the read pointer itself the moment the tab becomes visible (its
// IntersectionObserver), so this stays dumb.

import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import { EngagementMessages } from "@/components/engagements/engagement-messages";
import type { EngagementOption } from "@/components/assistant/assistant-store";

export function ClientMessagesTab({
  engagement,
  locale,
}: {
  engagement: EngagementOption | null;
  locale: "fr" | "en";
}) {
  const t = useTranslations("Assistant");

  if (!engagement) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <MessageSquare
          className="size-6 text-muted-foreground/60"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          {t("messages_pick_engagement")}
        </p>
      </div>
    );
  }

  const isLive =
    engagement.status === "sent" || engagement.status === "in_progress";

  return (
    <EngagementMessages
      key={engagement.id}
      engagementId={engagement.id}
      clientName={engagement.clientName}
      initialMessages={[]}
      deferInitialLoad
      notActivated={false}
      readOnly={!isLive}
      readOnlyReason={
        engagement.status === "cancelled"
          ? "cancelled"
          : engagement.status === "complete"
            ? "complete"
            : engagement.status === "draft"
              ? "draft"
              : null
      }
      locale={locale}
    />
  );
}

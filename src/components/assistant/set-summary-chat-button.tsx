"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { SquareArrowOutUpRight } from "lucide-react";
import { pushSetSummaryToChatAction } from "@/app/actions/assistant-summary";
import {
  openAssistantOnPageEngagement,
  reloadChat,
} from "@/components/assistant/assistant-store";

// Little "open in chat" button next to an item's document-check summary: posts
// the full summary into the engagement chat (so it stays in the history) and
// opens the assistant panel on it. Accountant-only (never on the client Preview).
export function SetSummaryChatButton({
  engagementId,
  itemId,
}: {
  engagementId: string;
  itemId: string;
}) {
  const t = useTranslations("Assistant");
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await pushSetSummaryToChatAction(engagementId, itemId);
          if (res.ok) {
            // Reload first (in case the panel is already open on this
            // engagement), then open it on the current page's engagement.
            reloadChat();
            openAssistantOnPageEngagement("chat");
          }
        })
      }
      aria-label={t("open_summary_in_chat")}
      title={t("open_summary_in_chat")}
      className="mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <SquareArrowOutUpRight className="size-3.5" aria-hidden />
    </button>
  );
}

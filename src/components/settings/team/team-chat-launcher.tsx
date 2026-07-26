"use client";

// The Team page's doorway to the firm's team chat. Two jobs:
//   1. While this page is mounted, publish `teamChatAvailable` so the bottom-
//      right chat launcher offers a Team mode. Unmounting (leaving the page)
//      retracts it, so the team chat is never a fixture elsewhere in the app.
//   2. The button opens that launcher straight into the team conversation.

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  openTeamChat,
  setTeamChatAvailable,
} from "@/components/assistant/chat-launcher-store";

export function TeamChatLauncher() {
  const t = useTranslations("TeamChat");

  useEffect(() => {
    setTeamChatAvailable(true);
    return () => setTeamChatAvailable(false);
  }, []);

  return (
    <Button type="button" variant="outline" size="sm" onClick={openTeamChat}>
      <MessagesSquare className="size-4" />
      {t("open_button")}
    </Button>
  );
}

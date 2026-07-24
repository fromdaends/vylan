"use client";

import { useEffect } from "react";
import {
  openAi,
  openMessages,
} from "@/components/assistant/chat-launcher-store";

// Deep-link opener: the engagement page renders this when the URL carries
// ?panel=<mode> — the notifications feed's Reply chip links to
// /engagements/[id]?panel=messages and lands straight in the popup's
// Client-messages mode. Renders nothing.
export function OpenPanelOnLoad({ tab }: { tab: "messages" | "ai" }) {
  useEffect(() => {
    if (tab === "messages") openMessages();
    else openAi();
  }, [tab]);
  return null;
}

"use client";

import { useEffect } from "react";
import {
  openAssistantOnPageEngagement,
  type AssistantTab,
} from "@/components/assistant/assistant-store";

// Deep-link opener: the engagement page renders this (AFTER the bridge, so
// the page's engagement is already published) when the URL carries
// ?panel=<tab> — e.g. the notifications feed's Reply chip links to
// /engagements/[id]?panel=messages and lands straight in the panel's
// Client-messages tab. Renders nothing.
export function OpenPanelOnLoad({ tab }: { tab: AssistantTab }) {
  useEffect(() => {
    openAssistantOnPageEngagement(tab);
  }, [tab]);
  return null;
}

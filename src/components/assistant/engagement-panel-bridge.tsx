"use client";

import { useEffect } from "react";
import {
  setPageEngagement,
  type PageEngagement,
} from "@/components/assistant/assistant-store";

// Rendered (invisibly) by the engagement detail page. Publishes the current
// engagement to the Assistant store while the page is mounted so the panel
// can preselect it and decide the FAB badge; clears on unmount so the panel
// never "sticks" to an engagement whose page the user has left.
export function AssistantEngagementBridge({
  engagement,
}: {
  engagement: PageEngagement;
}) {
  const { id, title, clientName, status, createdAt } = engagement;
  useEffect(() => {
    setPageEngagement({ id, title, clientName, status, createdAt });
    return () => setPageEngagement(null);
  }, [id, title, clientName, status, createdAt]);
  return null;
}

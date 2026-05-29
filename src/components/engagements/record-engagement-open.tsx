"use client";

import { useEffect } from "react";
import { recordOpen } from "@/lib/jump-back";

// Records (per-device) that the user opened this engagement, so the dashboard
// "Jump back in" card can surface it. Renders nothing.
export function RecordEngagementOpen({
  engagementId,
}: {
  engagementId: string;
}) {
  useEffect(() => {
    recordOpen(engagementId);
  }, [engagementId]);
  return null;
}

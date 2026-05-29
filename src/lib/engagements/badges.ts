import { cache } from "react";
import { loadEngagementWorklist } from "@/lib/dashboard/worklist";
import {
  readyToReviewCount,
  recentlyDeletedCount,
} from "@/lib/engagements/views";

export type EngagementBadges = {
  readyToReview: number;
  recentlyDeleted: number;
};

// Counts for the sidebar "Engagements" sub-nav badges, computed once per
// request (React.cache) and shared by the layout. Reuses the already-cached
// active-scope worklist (so the Overview/Inbox don't pay an extra query) and
// loads the small deleted set separately.
//
// FAIL-SOFT: this runs in the app shell on every page. A counting hiccup must
// never break navigation, so any error falls back to zeroes (no badge) rather
// than throwing into the layout render.
export const getEngagementBadges = cache(
  async function _getEngagementBadges(): Promise<EngagementBadges> {
    try {
      const [active, deleted] = await Promise.all([
        loadEngagementWorklist("active"),
        loadEngagementWorklist("deleted"),
      ]);
      return {
        readyToReview: readyToReviewCount(active),
        recentlyDeleted: recentlyDeletedCount(deleted),
      };
    } catch (e) {
      console.error("[getEngagementBadges] failed:", e);
      return { readyToReview: 0, recentlyDeleted: 0 };
    }
  },
);

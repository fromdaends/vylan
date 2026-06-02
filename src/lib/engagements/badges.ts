import { cache } from "react";
import {
  countReadyToReview,
  countRecentlyDeleted,
} from "@/lib/dashboard/worklist";

export type EngagementBadges = {
  readyToReview: number;
  recentlyDeleted: number;
};

// Counts for the sidebar "Engagements" sub-nav badges, computed once per request
// (React.cache) and shared by the layout. The ready-to-review count reuses the
// cached active-scope signals (so it dedupes with an Engagements/Overview page's
// own load — no extra query there, and no client/team-member name lookups on
// pages that don't need them); the recently-deleted count is a single COUNT over
// the 30-day window. The old path loaded TWO full worklists (active + deleted)
// on every page just for these two numbers.
//
// FAIL-SOFT: this runs in the app shell on every page. A counting hiccup must
// never break navigation, so any error falls back to zeroes (no badge) rather
// than throwing into the layout render.
export const getEngagementBadges = cache(
  async function _getEngagementBadges(): Promise<EngagementBadges> {
    try {
      const [readyToReview, recentlyDeleted] = await Promise.all([
        countReadyToReview(),
        countRecentlyDeleted(),
      ]);
      return { readyToReview, recentlyDeleted };
    } catch (e) {
      console.error("[getEngagementBadges] failed:", e);
      return { readyToReview: 0, recentlyDeleted: 0 };
    }
  },
);

"use client";

import { useEffect } from "react";
import { openCommentComposer } from "@/components/engagements/comment-thread";

// Deep-link opener: the engagement page renders this when the URL carries
// ?comment=1 — the dashboard worklist's right-click "Add a comment" lands
// straight in the engagement-level comment composer. Renders nothing.
// (Same pattern as OpenPanelOnLoad for ?panel=messages.)
export function OpenCommentComposerOnLoad({
  commentKey,
}: {
  commentKey: string;
}) {
  useEffect(() => {
    // Next paint, so the CommentThread's own event listener is mounted before
    // the open request fires.
    const frame = requestAnimationFrame(() => openCommentComposer(commentKey));
    return () => cancelAnimationFrame(frame);
  }, [commentKey]);
  return null;
}

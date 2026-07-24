"use client";

import { openSignWellSession } from "@/components/signwell/embed-loader";
import { finalizeSignaturePlacementAction } from "@/app/actions/signatures";

// Open SignWell's field-placement editor for a signature item and finalize
// (send + notify the client) when the accountant completes it. Collapses the app
// sidebar for room. `onSettled` runs after any terminal outcome so the caller can
// refresh. Shared by the "resume" (pending draft) and "retry" (failed setup)
// launchers, so the editor-open + finalize flow lives in exactly one place.
export async function openPlacementEditor(opts: {
  url: string;
  itemId: string;
  onSettled: () => void;
}): Promise<void> {
  await openSignWellSession({
    url: opts.url,
    collapseAppSidebar: true,
    onCompleted: async () => {
      try {
        await finalizeSignaturePlacementAction(opts.itemId);
      } catch {
        // Best-effort: the webhook/reconcile self-heal, and onSettled's refresh
        // shows the true status.
      }
      opts.onSettled();
    },
    // Closed without finishing (resume) or any error: just settle + refresh.
    onClosed: () => opts.onSettled(),
    onError: () => opts.onSettled(),
  });
}

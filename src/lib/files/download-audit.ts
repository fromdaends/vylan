// Recording that somebody downloaded a document — in ONE place, and on the byte
// ROUTES rather than in the buttons that link to them.
//
// WHY THE ROUTE. `file_downloaded` used to be written by a client-side call in
// the Files grid's row menu. That menu is one of several ways to download the
// same bytes: the engagement file row, the preview card, the preview detail
// pane, the in-app viewer's own download button and the client archive all link
// straight at these routes. Only the menu logged. So /settings/audit offered a
// "file downloaded" filter that returned a small fraction of real downloads,
// with nothing on screen saying the rest were missing — the worst shape an
// audit trail can take, because it reads as complete. A route cannot be
// bypassed the way a component call can: every existing link goes through here,
// and so does every link anyone adds later.
//
// TWO RULES decide whether a byte request counts as a download. Both are pure,
// so they are tested without a database:
//
//   1. ONLY ?download=1. These same routes serve the in-app viewer inline, and
//      a preview is a VIEW, not a download. Logging previews would also write
//      one row per pdf.js range request — hundreds while an accountant reads a
//      200-page return — and "file downloaded" would stop meaning anything.
//   2. ONLY THE FIRST BYTE RANGE. A resumable or multi-part download re-asks
//      for the same file with `Range: bytes=N-`. One download, one row.
//
// What is still NOT captured, stated so nobody reads this as airtight: opening
// a document inline and then using the browser's own Save command. That request
// is indistinguishable from a preview at the server, and guessing would be
// worse than the honest gap.

import { after } from "next/server";
import { logUserActivityAs } from "@/lib/db/activity";

/**
 * Which byte route served it — NOT which screen the operator was looking at.
 *
 * The route is the whole reason this is reliable, and the flip side is that it
 * cannot see the screen: /api/files/[id] is the shared proxy behind the Files
 * grid, the engagement file row, both preview panes and the in-app viewer
 * alike. Recording a screen here would mean guessing from the Referer, so this
 * records the thing that is actually known. `source` in the same row says which
 * table the document came from, which is the useful half anyway.
 */
export type DownloadRoute = "files" | "archive";

/**
 * Does this byte request count as a download for the audit log?
 *
 * `wantsDownload` is the route's own ?download=1 reading; `range` is the raw
 * Range request header (null when absent).
 */
export function countsAsDownload(input: {
  wantsDownload: boolean;
  range: string | null;
}): boolean {
  return input.wantsDownload && isRangeStart(input.range);
}

/**
 * True when this request is the START of a transfer rather than a continuation.
 *
 * No Range header at all is the ordinary whole-file download. `bytes=0-...` is
 * the first chunk of a chunked one. Anything else — `bytes=500-`, a suffix
 * range like `bytes=-500`, a multi-range list — is a continuation or a probe of
 * a transfer that was already counted.
 */
export function isRangeStart(range: string | null): boolean {
  if (!range) return true;
  const match = /^\s*bytes\s*=\s*(\d+)\s*-/i.exec(range);
  if (!match) return false;
  return match[1] === "0";
}

/**
 * Write the `file_downloaded` audit row for a download that has already been
 * authorized. Call ONLY after the route has resolved the document — an audit
 * entry saying somebody downloaded a file they could not read is worse than no
 * entry at all.
 *
 * Deferred with `after()` so the audit write never sits between the click and
 * the first byte, and best-effort: a failed log line must not fail a download.
 */
export function recordDocumentDownload(input: {
  firmId: string;
  /** Set when the document hangs off an engagement, so the audit row links. */
  engagementId: string | null;
  /** Set when it hangs off a client instead (imports, the archive). */
  clientId?: string | null;
  /** Which table the bytes came from — 'checklist' | 'final' | 'imported'. */
  source: string;
  documentId: string;
  fileName: string;
  route: DownloadRoute;
  /** Resolved from the session on the request path, never from the caller. */
  actorId: string | null;
}): void {
  const {
    firmId,
    engagementId,
    clientId,
    source,
    documentId,
    fileName,
    route,
    actorId,
  } = input;
  after(async () => {
    try {
      await logUserActivityAs(firmId, engagementId, actorId, "file_downloaded", {
        source,
        file_id: documentId,
        name: fileName,
        route,
        // enrichActivityEntries resolves a client from metadata.client_id for
        // rows with no engagement, which is what makes an imported or archived
        // document's download name its client on /settings/audit.
        ...(clientId ? { client_id: clientId } : {}),
      });
    } catch (e) {
      console.error("[download-audit] could not record a download:", e);
    }
  });
}

import type { PreviewDoc } from "./preview-model";

// Warm the browser cache for a document's DETAIL-size rendering BEFORE the user
// opens it, so the Preview detail shows the image instantly instead of waiting a
// few seconds for the on-demand thumbnail to generate + download.
//
// The detail viewer renders <img src="/api/files/[id]/thumb?w=1600"> — a
// resized JPEG generated on first request. We fetch that exact URL ahead of time
// via a throwaway Image(), so by the time the detail mounts the bytes are
// already in the browser cache. Only IMAGES use that thumb URL; PDFs render via
// pdf.js, so they're skipped here.
//
// Deduped per file id (module-level Set): an in-flight/cached request is already
// reused by the browser, but the Set avoids spawning redundant Image() objects
// on repeated hovers / re-renders. No-op during SSR.
const warmed = new Set<string>();

// Keep in sync with PreviewDocViewer's imageUrl.
const DETAIL_IMAGE_WIDTH = 1600;

export function preloadPreviewDoc(
  doc: Pick<PreviewDoc, "fileId" | "isImage">,
): void {
  if (typeof window === "undefined") return;
  if (!doc.isImage) return;
  if (warmed.has(doc.fileId)) return;
  warmed.add(doc.fileId);
  const img = new Image();
  img.decoding = "async";
  img.src = `/api/files/${doc.fileId}/thumb?w=${DETAIL_IMAGE_WIDTH}`;
}

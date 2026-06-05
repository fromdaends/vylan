"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";

// The document side of the detail split: a readable image (served as a larger
// web-safe JPEG via the thumb endpoint, so HEIC/webp originals show too) or a
// paged PDF (pdf.js, range-streamed via the /api/files proxy). Falls back to an
// open-in-new-tab link for anything it can't render.
export function PreviewDocViewer({
  fileId,
  isImage,
  isPdf,
  fileName,
}: {
  fileId: string;
  isImage: boolean;
  isPdf: boolean;
  fileName: string;
}) {
  const t = useTranslations("Preview");
  const fileUrl = `/api/files/${fileId}`;
  const imageUrl = `/api/files/${fileId}/thumb?w=1600`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (isImage && !failed) {
    return (
      <div className="flex size-full items-center justify-center overflow-auto bg-muted/20 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={fileName}
          onError={() => setFailed(true)}
          className="max-h-full max-w-full rounded object-contain shadow-sm"
        />
      </div>
    );
  }

  if (isPdf && !failed) {
    return (
      <div className="flex size-full flex-col bg-muted/20">
        <div
          ref={containerRef}
          className="flex flex-1 justify-center overflow-auto p-3"
        >
          {width > 0 && (
            <Document
              file={fileUrl}
              onLoadSuccess={(d) => setNumPages(d.numPages)}
              onLoadError={() => setFailed(true)}
              onSourceError={() => setFailed(true)}
              loading={<ViewerSpinner />}
              error={null}
            >
              <Page
                pageNumber={page}
                width={Math.min(width - 24, 1100)}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={<ViewerSpinner />}
                error={null}
                className="shadow-md"
              />
            </Document>
          )}
        </div>
        {numPages > 1 && (
          <div className="flex items-center justify-center gap-3 border-t border-border/40 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("prev_page")}
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("page_of", { page, total: numPages })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("next_page")}
              disabled={page >= numPages}
              onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 bg-muted/20 p-6 text-center text-sm text-muted-foreground">
      <FileText className="size-10 opacity-40" aria-hidden />
      <p>{t("viewer_unsupported")}</p>
      <a
        href={fileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline-offset-4 hover:underline"
      >
        {t("open_new_tab")}
      </a>
    </div>
  );
}

function ViewerSpinner() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

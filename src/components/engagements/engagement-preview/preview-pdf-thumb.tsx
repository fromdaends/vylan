"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

// Same vendored worker the full document viewer uses (public/pdf/, pinned to
// the installed pdfjs-dist). Setting it here is idempotent.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";

// Renders just the FIRST page of a PDF as a lightweight thumbnail, sized to its
// container width (top-aligned, so the form's title strip shows). pdf.js streams
// only the bytes it needs via the range-friendly /api/files proxy, so this is
// cheap even for big multi-page returns. Calls onError so the card can fall back
// to a generic icon if the PDF can't be read.
export default function PreviewPdfThumb({
  url,
  onError,
}: {
  url: string;
  onError?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
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

  return (
    <div ref={ref} className="size-full">
      {width > 0 && (
        <Document
          file={url}
          loading={null}
          error={null}
          onLoadError={onError}
          onSourceError={onError}
        >
          <Page
            pageNumber={1}
            width={width}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading={null}
            error={null}
            onRenderError={onError}
          />
        </Document>
      )}
    </div>
  );
}

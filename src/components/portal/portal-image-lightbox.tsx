"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  X,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/cn";

// pdf.js renderer (client-only). Dynamically imported so a portal with only
// photos never pulls the PDF engine into the bundle; it loads the first time a
// client opens a PDF.
const PreviewPdfThumb = dynamic(
  () => import("@/components/engagements/engagement-preview/preview-pdf-thumb"),
  { ssr: false },
);

export type LightboxItem = { id: string; name: string; kind: "image" | "pdf" };

// Full-screen enlarge view for the client's own uploaded documents. Photos show
// progressively (cached small thumbnail first, full render fades in); PDFs show
// their first page at a readable size with a link to open the full document.
// Plain by design: just the client's own file and its name, no status, no notes.
export function PortalImageLightbox({
  token,
  items,
  index,
  onClose,
  onIndexChange,
}: {
  token: string;
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const t = useTranslations("Portal");
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = items.length;
  const current = items[index];

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  // Move focus into the dialog and lock background scroll while open; restore
  // both on close so the portal page stays exactly where the client left it
  // (same scroll position, focus back on the file they tapped).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, go]);

  if (!current) return null;

  const enc = encodeURIComponent(token);
  const fileUrl = `/api/portal/files/${current.id}?token=${enc}`;
  const large = `/api/portal/files/${current.id}/thumb?token=${enc}&w=1600`;
  const small = `/api/portal/files/${current.id}/thumb?token=${enc}&w=144`;

  // A centred, floating panel over a dimmed + blurred backdrop, matching the
  // accountant-side PreviewOverlay. It renders through a portal on <body>
  // (see the return) so it floats above the whole page instead of inside the
  // checklist row.
  const overlay = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in-0"
      onMouseDown={(e) => {
        // Close only when the press starts on the backdrop itself — never on a
        // click inside the panel or a drag that happens to end on the backdrop.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={current.name}
        className="relative flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-2xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200"
      >
        {/* Header: the client's own file name, an open-in-tab link for PDFs,
            and the close button. */}
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
          <span
            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
            title={current.name}
          >
            {current.name}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {current.kind === "pdf" && (
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink className="size-4" aria-hidden />
                {t("preview_open_pdf")}
              </a>
            )}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={t("preview_close")}
              className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
        </div>

        {/* Body: ONE document at a time (image, or a PDF's first page), centred
            on a soft mat. Never renders all of an item's files at once. */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-muted/30 p-3">
          {current.kind === "pdf" ? (
            <LightboxPdf key={current.id} url={fileUrl} />
          ) : (
            <LightboxImage
              key={current.id}
              small={small}
              large={large}
              alt={current.name}
            />
          )}

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                aria-label={t("preview_prev")}
                className="absolute left-2 top-1/2 inline-flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="size-6" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                aria-label={t("preview_next")}
                className="absolute right-2 top-1/2 inline-flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="size-6" aria-hidden />
              </button>
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card/90 px-2.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums backdrop-blur-sm">
                {index + 1} / {count}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // Portal to <body>: lifts the overlay out of the checklist row, whose
  // entrance animation (fade-up with animation-fill-mode: both) leaves a
  // lingering transform that would otherwise make the row a containing block —
  // trapping this `fixed` overlay inside the row and, with scroll locked,
  // freezing the page. This is the actual fix for the "opens inside the row /
  // frozen" bug.
  return createPortal(overlay, document.body);
}

// The enlarged photo. Keyed by file id in the parent, so its `loaded` state
// resets automatically on prev/next (no set-state-in-effect needed). Shows the
// already-cached small thumbnail (blurred) instantly, then fades the full-size
// render in on top once it decodes.
function LightboxImage({
  small,
  large,
  alt,
}: {
  small: string;
  large: string;
  alt: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    // Fill the available area so the image renders large; object-contain keeps
    // aspect and upscales the small placeholder. (Sizing the box to the tiny
    // thumbnail's natural width was the "why so small / blank" bug.) No
    // stopPropagation, so tapping the photo also closes the viewer.
    <div className="relative size-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={small}
        alt=""
        aria-hidden
        className="absolute inset-0 size-full object-contain blur-md"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={large}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          "absolute inset-0 size-full object-contain transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Spinner only while genuinely loading; on failure we stop spinning and
          leave the blurred preview rather than spin forever. */}
      {!loaded && !failed && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-8 animate-spin text-white/70" aria-hidden />
        </span>
      )}
    </div>
  );
}

// The enlarged PDF: its first page rendered at a readable width on white, with
// a link in the top bar to open the full document. Falls back to a plain
// "open the PDF" affordance if the page can't be rendered in-browser.
function LightboxPdf({ url }: { url: string }) {
  const t = useTranslations("Portal");
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="flex flex-col items-center gap-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <FileText className="size-10 opacity-70" aria-hidden />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full bg-white/10 px-4 py-2 text-sm transition-colors hover:bg-white/20"
        >
          {t("preview_open_pdf")}
        </a>
      </div>
    );
  }

  return (
    <div
      className="max-h-[82vh] w-full max-w-3xl overflow-auto rounded-lg bg-white shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <PreviewPdfThumb url={url} onError={() => setFailed(true)} />
    </div>
  );
}

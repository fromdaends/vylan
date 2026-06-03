"use client";

// In-app document viewer for accountants reviewing client uploads.
//
// IMPORTANT: this module imports react-pdf, which pulls in pdf.js — that engine
// references browser-only globals (DOMMatrix, etc.) at import time and throws in
// Node. So this file must ONLY ever be loaded through `next/dynamic(..., { ssr:
// false })`. The consumer (file-preview-row.tsx) does exactly that, which also
// guarantees `document` exists on first render (no SSR pass).
//
// Design goals (why this exists): the old preview dropped large PDFs into an
// `<iframe sandbox="">`, which silently disabled the browser's native PDF
// reader and showed a blank white box with no loading or error state. This
// replaces that with:
//   • windowed page rendering — only a few pages near the viewport hold a
//     canvas, so a 200-page return uses the same memory as a 5-page one;
//   • page-by-page streaming from a same-origin range proxy (the `url` prop),
//     so the first page paints in well under a second;
//   • a real reading surface — thumbnail rail, zoom, rotate, jump-to-page,
//     continuous scroll, keyboard nav, fullscreen;
//   • a guaranteed fallback — if pdf.js ever fails to render, the user still
//     sees Open-in-new-tab + Download, never a blank screen.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  Printer,
  RotateCw,
  Rows3,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEFAULT_ZOOM,
  clampZoom,
  formatZoom,
  nextZoom,
  pagesToRender,
  parsePageInput,
  rotateBy,
} from "@/lib/pdf/viewer-helpers";

// Worker + standard fonts are vendored under /public/pdf so the viewer never
// depends on a CDN (matters for a financial app + CSP). See public/pdf/README.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf/pdf.worker.min.mjs";

// Stable references — react-pdf reloads the whole document if `options` or
// `file` change identity on every render, so these live at module scope.
const PDF_OPTIONS = {
  standardFontDataUrl: "/pdf/standard_fonts/",
} as const;

const OVERSCAN = 3; // pages kept rendered on each side of the current page
const PAGE_GAP = 16; // px between pages in the scroll column
const THUMB_WIDTH = 104; // px width of a thumbnail
const FALLBACK_PAGE_RATIO = 1.4142; // A4-ish, used before the real size is known

type NaturalSize = { width: number; height: number };

type ViewerSource = {
  /** Same-origin range proxy URL: /api/files/{id} */
  url: string;
  /** Download URL: /api/files/{id}?download=1 */
  downloadUrl: string;
  /** Inline open-in-new-tab URL (native browser viewer / print path). */
  openHref: string;
  filename: string;
  isImage: boolean;
};

function usePrefersReducedMotion() {
  // Lazy-init from the media query (this component is client-only), then only
  // update from the change event — never synchronously inside the effect body.
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function LoadingState({ progress }: { progress: number | null }) {
  const t = useTranslations("Engagements");
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
      <Loader2 className="size-6 animate-spin" aria-hidden />
      <p className="text-sm">{t("viewer_loading")}</p>
      {progress != null && (
        <div
          className="h-1 w-40 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-primary transition-[width] duration-150"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// Never a blank screen: if pdf.js can't render, the accountant still gets the
// file via the browser's own viewer or a download.
function FallbackState({
  source,
  compact,
}: {
  source: ViewerSource;
  compact?: boolean;
}) {
  const t = useTranslations("Engagements");
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        compact ? "py-8 px-4" : "py-16 px-6",
      )}
    >
      <AlertTriangle className="size-6 text-amber-500" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {t("viewer_error_title")}
        </p>
        <p className="text-xs text-muted-foreground">{t("viewer_error_body")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          href={source.openHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          {t("open_new_tab")}
        </a>
        <a
          href={source.downloadUrl}
          download={source.filename}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="size-3.5" aria-hidden />
          {t("download_file")}
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline preview — first page only, fast, with a launcher into the full viewer.
// ---------------------------------------------------------------------------

export function InlinePdfPreview({
  source,
  onOpenFull,
}: {
  source: ViewerSource;
  onOpenFull: () => void;
}) {
  const t = useTranslations("Engagements");
  const [numPages, setNumPages] = useState<number | null>(null);
  const [errored, setErrored] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (errored) return <FallbackState source={source} compact />;

  return (
    <div ref={containerRef} className="relative">
      <Document
        file={source.url}
        options={PDF_OPTIONS}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        onLoadProgress={({ loaded, total }) =>
          setProgress(total ? loaded / total : null)
        }
        onLoadError={() => setErrored(true)}
        onSourceError={() => setErrored(true)}
        loading={<LoadingState progress={progress} />}
        error={<FallbackState source={source} compact />}
        className="flex justify-center"
      >
        {width > 0 && (
          <Page
            pageNumber={1}
            width={Math.min(width, 720)}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            className="overflow-hidden rounded border border-border shadow-sm [&_canvas]:!h-auto [&_canvas]:!max-w-full"
            loading={<LoadingState progress={progress} />}
          />
        )}
      </Document>

      {/* Launcher overlay — clear call to open the full reading surface. */}
      <button
        type="button"
        onClick={onOpenFull}
        className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-background/95 to-transparent pb-2 pt-8 text-xs font-medium text-foreground opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      >
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 shadow-sm">
          <Maximize2 className="size-3.5" aria-hidden />
          {numPages && numPages > 1
            ? t("viewer_open_full_n", { count: numPages })
            : t("viewer_open_full")}
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One page slot in the continuous-scroll column. Renders the heavy <Page>
// canvas only when within the current window; otherwise reserves an estimated
// height so the scrollbar stays accurate and there's no layout jump. (Tax PDFs
// have uniform page sizes, so the estimate matches the real height exactly.)
// ---------------------------------------------------------------------------

function PageSlot({
  pageNumber,
  active,
  scale,
  rotation,
  reservedHeight,
  registerRef,
}: {
  pageNumber: number;
  active: boolean;
  scale: number;
  rotation: number;
  reservedHeight: number;
  registerRef: (page: number, el: HTMLDivElement | null) => void;
}) {
  const t = useTranslations("Engagements");
  return (
    <div
      ref={(el) => registerRef(pageNumber, el)}
      data-page={pageNumber}
      className="flex flex-col items-center"
      style={{ minHeight: active ? undefined : reservedHeight }}
    >
      {active ? (
        <Page
          pageNumber={pageNumber}
          scale={scale}
          rotate={rotation}
          className="bg-white shadow-md ring-1 ring-black/5"
          loading={
            <div
              className="flex items-center justify-center bg-muted/40"
              style={{ height: reservedHeight, width: 200 }}
            >
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          }
        />
      ) : (
        <div
          className="flex w-full items-center justify-center rounded bg-muted/30"
          style={{ height: reservedHeight }}
          aria-hidden
        >
          <span className="text-xs text-muted-foreground">
            {t("viewer_page", { page: pageNumber })}
          </span>
        </div>
      )}
    </div>
  );
}

// A lazily-rendered thumbnail (mount-once when scrolled into the rail).
function Thumb({
  pageNumber,
  current,
  rootRef,
  onClick,
}: {
  pageNumber: number;
  current: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  onClick: () => void;
}) {
  const t = useTranslations("Engagements");
  const ref = useRef<HTMLButtonElement>(null);
  const [show, setShow] = useState(pageNumber <= 8); // first few eagerly

  useEffect(() => {
    if (show) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { root: rootRef.current, rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show, rootRef]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={t("viewer_go_to_page", { page: pageNumber })}
      aria-current={current ? "true" : undefined}
      className={cn(
        "group flex w-full flex-col items-center gap-1 rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        current ? "bg-primary/10" : "hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "overflow-hidden rounded ring-1 transition-shadow",
          current
            ? "ring-2 ring-primary"
            : "ring-black/10 group-hover:ring-primary/40",
        )}
        style={{ width: THUMB_WIDTH }}
      >
        {show ? (
          <Page
            pageNumber={pageNumber}
            width={THUMB_WIDTH}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading={
              <div
                style={{
                  width: THUMB_WIDTH,
                  height: THUMB_WIDTH * FALLBACK_PAGE_RATIO,
                }}
                className="bg-muted"
              />
            }
          />
        ) : (
          <div
            style={{
              width: THUMB_WIDTH,
              height: THUMB_WIDTH * FALLBACK_PAGE_RATIO,
            }}
            className="bg-muted"
          />
        )}
      </span>
      <span
        className={cn(
          "text-[11px] tabular-nums",
          current ? "font-semibold text-primary" : "text-muted-foreground",
        )}
      >
        {pageNumber}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Image stage (for jpeg/png/webp/heic→jpeg scans) — zoom + rotate.
// ---------------------------------------------------------------------------

function ImageStage({
  source,
  scale,
  rotation,
}: {
  source: ViewerSource;
  scale: number;
  rotation: number;
}) {
  const t = useTranslations("Engagements");
  const [errored, setErrored] = useState(false);
  if (errored) return <FallbackState source={source} />;
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source.url}
        alt={source.filename || t("viewer_image_alt")}
        onError={() => setErrored(true)}
        style={{
          transform: `scale(${scale}) rotate(${rotation}deg)`,
          transition: "transform 150ms ease",
        }}
        className="max-h-[82vh] max-w-full select-none rounded bg-white shadow-md ring-1 ring-black/5"
        draggable={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The fullscreen viewer modal.
// ---------------------------------------------------------------------------

export function DocumentViewerModal({
  source,
  onClose,
}: {
  source: ViewerSource;
  onClose: () => void;
}) {
  const t = useTranslations("Engagements");
  const reducedMotion = usePrefersReducedMotion();

  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  // `userScale` is the explicit zoom the accountant set; until they touch zoom
  // we derive the scale from fit-to-width so the page fills the stage.
  const [userScale, setUserScale] = useState<number | null>(null);
  const [rotation, setRotation] = useState(0);
  const [errored, setErrored] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [showThumbs, setShowThumbs] = useState(true);
  const [natural, setNatural] = useState<NaturalSize | null>(null);
  const [stageWidth, setStageWidth] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const slotRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const registerRef = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el) slotRefs.current.set(page, el);
    else slotRefs.current.delete(page);
  }, []);

  // Focus management + body scroll lock. (No SSR — this is loaded ssr:false.)
  useEffect(() => {
    const restore = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const id = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.clearTimeout(id);
      restore?.focus?.();
    };
  }, []);

  // Track the stage width so we can compute a fit-to-width scale.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStageWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitWidthScale = useMemo(() => {
    if (!natural || stageWidth <= 0) return null;
    const usable = stageWidth - 48; // horizontal padding
    const naturalW = rotation % 180 === 0 ? natural.width : natural.height;
    if (naturalW <= 0) return null;
    return clampZoom(usable / naturalW);
  }, [natural, stageWidth, rotation]);

  // Effective scale: the user's explicit zoom wins; otherwise fit-to-width;
  // otherwise 100%. Derived during render — no effects, no flicker.
  const scale = userScale ?? fitWidthScale ?? DEFAULT_ZOOM;

  // Estimated CSS height of a page at the current scale/rotation — used to
  // reserve space for not-yet-rendered slots so scrolling stays smooth.
  const estimatedHeight = useMemo(() => {
    if (!natural) return Math.round((stageWidth || 600) * FALLBACK_PAGE_RATIO);
    const naturalH = rotation % 180 === 0 ? natural.height : natural.width;
    return Math.max(120, Math.round(naturalH * scale));
  }, [natural, scale, rotation, stageWidth]);

  const onDocumentLoad = useCallback(
    async (pdf: {
      numPages: number;
      getPage: (n: number) => Promise<unknown>;
    }) => {
      setNumPages(pdf.numPages);
      try {
        const page = (await pdf.getPage(1)) as {
          getViewport: (o: { scale: number }) => {
            width: number;
            height: number;
          };
        };
        const vp = page.getViewport({ scale: 1 });
        setNatural({ width: vp.width, height: vp.height });
      } catch {
        // Non-fatal — we fall back to an A4-ish estimate for spacing.
      }
    },
    [],
  );

  const renderWindow = useMemo(
    () => new Set(pagesToRender(currentPage, numPages, OVERSCAN)),
    [currentPage, numPages],
  );

  // Derive the current page from scroll position (rAF-throttled).
  const rafRef = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const root = scrollRef.current;
      if (!root || numPages === 0) return;
      const focusLine = root.scrollTop + root.clientHeight * 0.35;
      let best = 1;
      for (let p = 1; p <= numPages; p++) {
        const el = slotRefs.current.get(p);
        if (!el) continue;
        if (el.offsetTop <= focusLine) best = p;
        else break;
      }
      setCurrentPage((prev) => (prev === best ? prev : best));
    });
  }, [numPages]);

  const scrollToPage = useCallback(
    (page: number) => {
      const el = slotRefs.current.get(page);
      if (!el) {
        // Slot not mounted yet — set current so the window includes it, then
        // scroll on the next frame once it exists.
        setCurrentPage(page);
        window.requestAnimationFrame(() => {
          slotRefs.current
            .get(page)
            ?.scrollIntoView({ block: "start", behavior: "auto" });
        });
        return;
      }
      el.scrollIntoView({
        block: "start",
        behavior: reducedMotion ? "auto" : "smooth",
      });
      setCurrentPage(page);
    },
    [reducedMotion],
  );

  // Keyboard navigation.
  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (source.isImage) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT") return; // don't hijack the page input
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          scrollToPage(Math.min(numPages, currentPage + 1));
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          scrollToPage(Math.max(1, currentPage - 1));
          break;
        case "Home":
          e.preventDefault();
          scrollToPage(1);
          break;
        case "End":
          e.preventDefault();
          scrollToPage(numPages);
          break;
        case "+":
        case "=":
          e.preventDefault();
          setUserScale(nextZoom(scale, 1));
          break;
        case "-":
          e.preventDefault();
          setUserScale(nextZoom(scale, -1));
          break;
        default:
          break;
      }
    },
    [currentPage, numPages, onClose, scale, scrollToPage, source.isImage],
  );

  const zoomLabel = formatZoom(scale);

  const overlay = (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-neutral-900/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={source.filename || t("viewer_document")}
      onKeyDown={onKeyDown}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-white/10 bg-neutral-900 px-3 py-2 text-neutral-100">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className="truncate text-sm font-medium"
            title={source.filename}
          >
            {source.filename}
          </span>
        </span>

        {!source.isImage && numPages > 0 && (
          <span className="hidden items-center gap-1.5 text-xs text-neutral-300 sm:flex">
            <input
              key={currentPage}
              defaultValue={currentPage}
              aria-label={t("viewer_go_to_page_field")}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const p = parsePageInput(e.currentTarget.value, numPages);
                  if (p) scrollToPage(p);
                  else e.currentTarget.value = String(currentPage);
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                const p = parsePageInput(e.currentTarget.value, numPages);
                if (p) scrollToPage(p);
                else e.currentTarget.value = String(currentPage);
              }}
              inputMode="numeric"
              className="w-12 rounded border border-white/20 bg-neutral-800 px-1.5 py-1 text-center text-xs tabular-nums text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="tabular-nums">
              {t("viewer_of_n", { total: numPages })}
            </span>
          </span>
        )}

        {/* Zoom + rotate */}
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            label={t("viewer_zoom_out")}
            onClick={() => setUserScale(nextZoom(scale, -1))}
          >
            <Minus className="size-4" aria-hidden />
          </ToolbarButton>
          <button
            type="button"
            onClick={() => setUserScale(null)}
            className="min-w-[3.25rem] rounded px-1.5 py-1 text-center text-xs tabular-nums text-neutral-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            title={t("viewer_fit_width")}
          >
            {zoomLabel}
          </button>
          <ToolbarButton
            label={t("viewer_zoom_in")}
            onClick={() => setUserScale(nextZoom(scale, 1))}
          >
            <Plus className="size-4" aria-hidden />
          </ToolbarButton>
          <ToolbarButton
            label={t("viewer_rotate")}
            onClick={() => setRotation((r) => rotateBy(r, 90))}
          >
            <RotateCw className="size-4" aria-hidden />
          </ToolbarButton>
        </div>

        <span className="mx-1 hidden h-5 w-px bg-white/15 sm:block" aria-hidden />

        {/* Actions */}
        <div className="flex items-center gap-0.5">
          {!source.isImage && numPages > 1 && (
            <ToolbarButton
              label={t("viewer_toggle_thumbnails")}
              onClick={() => setShowThumbs((v) => !v)}
              active={showThumbs}
              className="hidden md:inline-flex"
            >
              <Rows3 className="size-4" aria-hidden />
            </ToolbarButton>
          )}
          <ToolbarLink href={source.openHref} label={t("open_new_tab")}>
            <ExternalLink className="size-4" aria-hidden />
          </ToolbarLink>
          <ToolbarButton
            label={t("viewer_print")}
            onClick={() => window.open(source.openHref, "_blank", "noopener")}
          >
            <Printer className="size-4" aria-hidden />
          </ToolbarButton>
          <ToolbarLink
            href={source.downloadUrl}
            label={t("download_file")}
            download={source.filename}
          >
            <Download className="size-4" aria-hidden />
          </ToolbarLink>
          <ToolbarButton
            ref={closeBtnRef}
            label={t("viewer_close")}
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </ToolbarButton>
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        {source.isImage ? (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <ImageStage source={source} scale={scale} rotation={rotation} />
          </div>
        ) : errored ? (
          <div className="flex flex-1 items-center justify-center">
            <FallbackState source={source} />
          </div>
        ) : (
          <Document
            file={source.url}
            options={PDF_OPTIONS}
            onLoadSuccess={onDocumentLoad}
            onLoadProgress={({ loaded, total }) =>
              setProgress(total ? loaded / total : null)
            }
            onLoadError={() => setErrored(true)}
            onSourceError={() => setErrored(true)}
            loading={
              <div className="flex flex-1 items-center justify-center">
                <LoadingState progress={progress} />
              </div>
            }
            error={
              <div className="flex flex-1 items-center justify-center">
                <FallbackState source={source} />
              </div>
            }
            className="flex min-h-0 flex-1"
          >
            {/* Thumbnail rail */}
            {showThumbs && numPages > 1 && (
              <div
                ref={railRef}
                className="hidden w-[136px] shrink-0 overflow-y-auto border-r border-white/10 bg-neutral-900/60 p-2 md:block"
              >
                <div className="space-y-1">
                  {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                    <Thumb
                      key={p}
                      pageNumber={p}
                      current={p === currentPage}
                      rootRef={railRef}
                      onClick={() => scrollToPage(p)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Continuous-scroll page column */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="min-h-0 flex-1 overflow-auto bg-neutral-800/40 px-4 py-4"
            >
              <div
                className="mx-auto flex flex-col items-center"
                style={{ gap: PAGE_GAP }}
              >
                {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                  <PageSlot
                    key={p}
                    pageNumber={p}
                    active={renderWindow.has(p)}
                    scale={scale}
                    rotation={rotation}
                    reservedHeight={estimatedHeight}
                    registerRef={registerRef}
                  />
                ))}
              </div>
            </div>
          </Document>
        )}
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}

// ---------------------------------------------------------------------------
// Small toolbar primitives
// ---------------------------------------------------------------------------

function ToolbarButton({
  ref,
  children,
  label,
  onClick,
  active,
  className,
}: {
  ref?: Ref<HTMLButtonElement>;
  children: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 items-center justify-center rounded text-neutral-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        active && "bg-white/15 text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ToolbarLink({
  href,
  children,
  label,
  download,
}: {
  href: string;
  children: ReactNode;
  label: string;
  download?: string;
}) {
  return (
    <a
      href={href}
      target={download ? undefined : "_blank"}
      rel="noopener noreferrer"
      download={download}
      aria-label={label}
      title={label}
      className="inline-flex size-8 items-center justify-center rounded text-neutral-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children}
    </a>
  );
}

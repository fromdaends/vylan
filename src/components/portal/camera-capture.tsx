"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  X,
  Camera,
  Check,
  RotateCcw,
  Loader2,
  Flashlight,
  ImageUp,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useCameraStream, type CameraErrorCode } from "./use-camera-stream";
import {
  captureVideoFrame,
  captureVideoFrameRectified,
  coverSourceRect,
} from "@/lib/portal/capture-frame";
import {
  toGrayscale,
  computeMetrics,
  guidanceFor,
  type Gray,
  type Guidance,
} from "@/lib/portal/frame-metrics";
import {
  advanceShutter,
  INITIAL_SHUTTER,
  type ShutterState,
} from "@/lib/portal/auto-shutter";
import { detectQuad, smoothQuad, quadArea } from "@/lib/portal/detect-quad";
import type { Quad } from "@/lib/portal/rectify";

// Width of the hidden analysis canvas. Everything the scanner "sees" happens at
// this size: 256px is enough to find the edges of a sheet of paper and cheap
// enough to do ~10x a second on a mid-range phone without heating it up.
const DETECT_WIDTH = 256;
// ~10 fps. Faster buys no accuracy (a hand doesn't move meaningfully in 100ms)
// and costs battery.
const ANALYSIS_INTERVAL_MS = 100;
// Consecutive good frames before the shutter fires itself. Six frames ≈ 0.6s of
// "everything is fine", which is long enough not to fire mid-wobble and short
// enough that it still feels instant.
const READY_FRAMES_REQUIRED = 6;
// Corner easing per frame, and the jump distance (in preview px) past which we
// snap instead of easing — that's the client moving to a different document.
const SMOOTHING_ALPHA = 0.35;
const SMOOTHING_RESET_PX = 90;
// How many consecutive misses the outline survives before it disappears.
// Three frames ≈ 0.3s: long enough to ride out a single dropped detection,
// short enough that a document leaving the frame doesn't leave a ghost.
const MISS_GRACE_FRAMES = 3;

type Shot = { file: File; url: string };

export function CameraCapture({
  onClose,
  onCapture,
  onChooseFile,
}: {
  onClose: () => void;
  /** Hand the finished photo to the caller's existing upload path. */
  onCapture: (file: File) => void;
  /** Escape hatch offered whenever the camera can't be used. */
  onChooseFile: () => void;
}) {
  const t = useTranslations("Portal");
  const camera = useCameraStream();
  const { start, stop, status, stream } = camera;

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevGrayRef = useRef<Gray | null>(null);
  const quadRef = useRef<Quad | null>(null);
  const shutterRef = useRef<ShutterState>(INITIAL_SHUTTER);
  const capturingRef = useRef(false);

  const [view, setView] = useState({ width: 0, height: 0 });
  const [quad, setQuad] = useState<Quad | null>(null);
  const [guidance, setGuidance] = useState<Guidance>("searching");
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  // The overlay only ever mounts in response to the client tapping "Scan", so
  // asking here is still inside the gesture that authorised it.
  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  // Attach the stream. srcObject can't be set declaratively.
  //
  // `shot` is a dependency even though it is unused below: taking a photo
  // swaps the <video> out for the still, and going back via Retake mounts a
  // BRAND NEW element. Keyed on `stream` alone this effect would not re-run,
  // nothing would attach to the new element, and Retake would show black.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    try {
      video.srcObject = stream;
    } catch {
      // Some engines type-check this setter strictly. Throwing out of an
      // effect would unmount the whole overlay and strand the client, so a
      // failure here just means no preview — the error card still shows.
      return;
    }
    // Autoplay is unreliable on iOS even when muted; kick it explicitly and
    // swallow the AbortError that a fast close produces. Optional-called
    // because the test DOM's video element has no play().
    void video.play?.()?.catch?.(() => undefined);
    return () => {
      try {
        video.srcObject = null;
      } catch {
        /* nothing left to detach */
      }
    };
  }, [stream, shot]);

  // Track the on-screen preview size: every coordinate the scanner produces is
  // in this space, and it changes on rotate.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    // Only publish a genuinely new size: ResizeObserver fires liberally, and a
    // fresh object with identical numbers would still restart the scanning
    // effect (and with it the auto-shutter's streak).
    const measure = () =>
      setView((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // Lock background scroll and restore focus, matching the lightbox.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Free the preview blob URL when the shot is discarded or we unmount.
  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  // Read through a ref so `capture` keeps a stable identity: it is a dependency
  // of the scanning effect, and re-creating it would tear the loop down and
  // reset the auto-shutter's run of good frames every time the preview is
  // remeasured.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || capturingRef.current) return;
    capturingRef.current = true;
    setBusy(true);
    setCaptureError(null);
    try {
      const size = viewRef.current;
      const q = quadRef.current;
      const file =
        q && size.width > 0
          ? await captureVideoFrameRectified(video, q, size)
          : await captureVideoFrame(video, { view: size });
      setShot({ file, url: URL.createObjectURL(file) });
    } catch {
      setCaptureError("capture_failed");
    } finally {
      capturingRef.current = false;
      setBusy(false);
    }
  }, []);

  // The scanning loop. Draws the visible part of the frame into a small hidden
  // canvas, then hands plain pixel buffers to the pure analysis modules.
  useEffect(() => {
    if (status !== "ready" || shot) return;
    if (view.width <= 0 || view.height <= 0) return;

    let raf = 0;
    let last = 0;
    let cancelled = false;

    const canvas =
      detectCanvasRef.current ?? document.createElement("canvas");
    detectCanvasRef.current = canvas;
    const height = Math.max(
      1,
      Math.round((DETECT_WIDTH * view.height) / view.width),
    );
    canvas.width = DETECT_WIDTH;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    function tick(now: number) {
      if (cancelled) return;
      raf = requestAnimationFrame(tick);
      if (now - last < ANALYSIS_INTERVAL_MS) return;
      last = now;

      const video = videoRef.current;
      // HAVE_CURRENT_DATA — anything less and getImageData reads black.
      if (!ctx || !video || video.readyState < 2) return;

      // Draw the video the same way CSS paints it (object-fit: cover): take
      // the centre crop the client can actually see, not the whole sensor
      // frame. Squashing the full frame in here instead makes detection space
      // a DIFFERENT coordinate system from preview space, and the outline
      // lands somewhere other than the document it found.
      const src = coverSourceRect(
        { width: video.videoWidth, height: video.videoHeight },
        view,
      );
      try {
        ctx.drawImage(
          video,
          src.x,
          src.y,
          src.width,
          src.height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      } catch {
        return;
      }
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const gray = toGrayscale({
        data: rgba.data,
        width: rgba.width,
        height: rgba.height,
      });

      const found = detectQuad(gray);
      const smoothed = found
        ? smoothQuad(
            quadRef.current
              ? scaleToDetect(quadRef.current, view, canvas)
              : null,
            found,
            SMOOTHING_ALPHA,
            (SMOOTHING_RESET_PX * canvas.width) / view.width,
          )
        : null;

      const areaFraction = smoothed
        ? quadArea(smoothed) / (canvas.width * canvas.height)
        : null;

      const metrics = computeMetrics(gray, prevGrayRef.current, areaFraction);
      prevGrayRef.current = gray;

      // All the frame-to-frame bookkeeping — how long the document has looked
      // good, how long it has been missing, whether to shoot — lives in a pure
      // reducer so it can actually be tested. This loop only does the parts
      // that need a canvas.
      const step = advanceShutter(shutterRef.current, {
        detected: smoothed !== null,
        guidanceFor: (documentPresent) =>
          guidanceFor(metrics, documentPresent),
        graceFrames: MISS_GRACE_FRAMES,
        requiredFrames: READY_FRAMES_REQUIRED,
      });
      shutterRef.current = step.state;

      setGuidance((g) => (g === step.guidance ? g : step.guidance));

      if (step.outline === "update" && smoothed) {
        const inView = scaleToView(smoothed, view, canvas);
        quadRef.current = inView;
        setQuad(inView);
      } else if (step.outline === "clear") {
        quadRef.current = null;
        setQuad(null);
      }

      if (step.fire) void capture();
    }

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      prevGrayRef.current = null;
      shutterRef.current = INITIAL_SHUTTER;
    };
  }, [status, shot, view, capture]);

  function retake() {
    setShot(null);
    setCaptureError(null);
    shutterRef.current = INITIAL_SHUTTER;
    quadRef.current = null;
    setQuad(null);
    setGuidance("searching");
  }

  function useShot() {
    if (!shot) return;
    onCapture(shot.file);
    onClose();
  }

  const failed =
    status === "denied" || status === "error" || status === "unavailable";

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("scan_title")}
      className="fixed inset-0 z-[70] flex flex-col bg-black text-white"
    >
      {/* Stage — camera preview or the captured shot. */}
      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        {!shot && (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            // playsInline is load-bearing: without it iOS Safari promotes the
            // video to its native fullscreen player and this whole overlay
            // disappears behind it.
            className="absolute inset-0 size-full object-cover"
          />
        )}

        {shot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shot.url}
            alt={t("scan_review_alt")}
            className="absolute inset-0 size-full object-contain"
          />
        )}

        {!shot && !failed && (
          <ScanOverlay view={view} quad={quad} ready={guidance === "ready"} />
        )}

        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-8 animate-spin text-white/70" aria-hidden />
          </div>
        )}

        {failed && <CameraUnavailable code={camera.error ?? "camera_failed"} />}

        {/* Live coaching. aria-live so a screen-reader user hears the same
            guidance a sighted client reads. */}
        {!shot && !failed && status === "ready" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
            <p
              aria-live="polite"
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-medium backdrop-blur-sm transition-colors",
                guidance === "ready"
                  ? "bg-emerald-500/90 text-white"
                  : "bg-black/60 text-white/90",
              )}
            >
              {t(`scan_hint_${guidance}`)}
            </p>
          </div>
        )}

        {captureError && (
          <div className="pointer-events-none absolute inset-x-0 bottom-16 flex justify-center px-4">
            <p className="rounded-full bg-red-500/90 px-3.5 py-1.5 text-sm font-medium">
              {t("errors.capture_failed")}
            </p>
          </div>
        )}

        {/* Close: top-right, clear of the notch. */}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("scan_close")}
          className="absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
        >
          <X className="size-5" aria-hidden />
        </button>

        {camera.torchSupported && !shot && (
          <button
            type="button"
            onClick={camera.toggleTorch}
            aria-label={t("scan_torch")}
            aria-pressed={camera.torchOn}
            className={cn(
              "absolute left-3 inline-flex size-10 items-center justify-center rounded-full backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
              camera.torchOn
                ? "bg-white text-black"
                : "bg-black/50 text-white hover:bg-black/70",
            )}
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
          >
            <Flashlight className="size-5" aria-hidden />
          </button>
        )}
      </div>

      {/* Controls */}
      <div
        className="flex shrink-0 items-center justify-center gap-6 bg-black px-6 py-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        {shot ? (
          <>
            <button
              type="button"
              onClick={retake}
              className="inline-flex items-center gap-2 rounded-full border border-white/25 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <RotateCcw className="size-4" aria-hidden />
              {t("scan_retake")}
            </button>
            <button
              type="button"
              onClick={useShot}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Check className="size-4" aria-hidden />
              {t("scan_use")}
            </button>
          </>
        ) : failed ? (
          <button
            type="button"
            onClick={() => {
              onChooseFile();
              onClose();
            }}
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <ImageUp className="size-4" aria-hidden />
            {t("scan_choose_file")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void capture()}
            disabled={status !== "ready" || busy}
            aria-label={t("scan_capture")}
            className="inline-flex size-16 items-center justify-center rounded-full border-4 border-white/80 bg-white/15 backdrop-blur-sm transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40 motion-safe:active:scale-95"
          >
            {busy ? (
              <Loader2 className="size-7 animate-spin text-white" aria-hidden />
            ) : (
              <Camera className="size-7 text-white" aria-hidden />
            )}
          </button>
        )}
      </div>
    </div>
  );

  // Portal to <body>: the checklist row's entrance animation leaves a lingering
  // transform (animation-fill-mode: both), which makes the row a containing
  // block and would trap this fixed overlay inside it — the same trap
  // portal-image-lightbox documents.
  return createPortal(overlay, document.body);
}

// ---------------------------------------------------------------------------

/** Corner brackets plus the live document outline. */
function ScanOverlay({
  view,
  quad,
  ready,
}: {
  view: { width: number; height: number };
  quad: Quad | null;
  ready: boolean;
}) {
  if (view.width <= 0 || view.height <= 0) return null;
  const inset = Math.round(Math.min(view.width, view.height) * 0.08);
  const arm = Math.round(Math.min(view.width, view.height) * 0.07);
  const right = view.width - inset;
  const bottom = view.height - inset;

  const corners = [
    `M ${inset} ${inset + arm} L ${inset} ${inset} L ${inset + arm} ${inset}`,
    `M ${right - arm} ${inset} L ${right} ${inset} L ${right} ${inset + arm}`,
    `M ${right} ${bottom - arm} L ${right} ${bottom} L ${right - arm} ${bottom}`,
    `M ${inset + arm} ${bottom} L ${inset} ${bottom} L ${inset} ${bottom - arm}`,
  ];

  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${view.width} ${view.height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {/* Brackets fade back once the document itself is outlined — two
          competing frames on screen at once reads as clutter. */}
      <g
        className="transition-opacity duration-300"
        opacity={quad ? 0.25 : 0.8}
        stroke="white"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {corners.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {quad && (
        <polygon
          points={quad.map((p) => `${p.x},${p.y}`).join(" ")}
          className="transition-[fill,stroke] duration-200"
          fill={ready ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.10)"}
          stroke={ready ? "rgb(16,185,129)" : "rgba(255,255,255,0.9)"}
          strokeWidth={3}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/**
 * Shown whenever the camera can't be used. Explains what happened and, for a
 * denial, how to undo it — the way back to the ordinary file picker lives in
 * the control bar below, so it is not repeated here.
 */
function CameraUnavailable({ code }: { code: CameraErrorCode }) {
  const t = useTranslations("Portal");
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <Camera className="mx-auto size-8 text-white/50" aria-hidden />
        <p className="text-sm text-white/90">{t(`errors.${code}`)}</p>
        {code === "camera_denied" && (
          <p className="text-xs text-white/60">{t("scan_denied_help")}</p>
        )}
      </div>
    </div>
  );
}

// --- coordinate helpers -----------------------------------------------------
// Detection runs on a small canvas; the outline is drawn in preview pixels.

function scaleToView(
  q: Quad,
  view: { width: number; height: number },
  canvas: { width: number; height: number },
): Quad {
  const sx = view.width / canvas.width;
  const sy = view.height / canvas.height;
  return q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as unknown as Quad;
}

function scaleToDetect(
  q: Quad,
  view: { width: number; height: number },
  canvas: { width: number; height: number },
): Quad {
  const sx = canvas.width / view.width;
  const sy = canvas.height / view.height;
  return q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as unknown as Quad;
}

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
  CopyPlus,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useCameraStream, type CameraErrorCode } from "./use-camera-stream";
import {
  captureVideoFrame,
  captureVideoFrameRectified,
  coverSourceRect,
  measureCaptureSharpness,
} from "@/lib/portal/capture-frame";
import {
  toGrayscale,
  computeMetrics,
  guidanceFor,
  sharpnessFloorFor,
  normaliseMotion,
  isReviewBlurry,
  GUIDANCE_THRESHOLDS,
  REVIEW_SHARPNESS_WIDTH,
  type Gray,
  type Guidance,
} from "@/lib/portal/frame-metrics";
import {
  loadScanEngine,
  currentScanEngine,
  getScanEngineStatus,
  getScanEngineError,
  subscribeScanEngine,
} from "@/lib/portal/opencv-loader";
import { detectQuadCv } from "@/lib/portal/cv-detect";
import {
  advanceArm,
  disarm,
  ARMED,
  type ArmState,
} from "@/lib/portal/capture-arm";
import {
  advanceShutter,
  INITIAL_SHUTTER,
  type ShutterState,
} from "@/lib/portal/auto-shutter";
import {
  advanceHint,
  INITIAL_HINT,
  type HintState,
} from "@/lib/portal/hint-visibility";
import {
  detectQuad,
  quadArea,
  stabiliseQuad,
  INITIAL_QUAD_STABILITY,
  type QuadStability,
} from "@/lib/portal/detect-quad";
import type { Quad } from "@/lib/portal/rectify";

// Width of the hidden analysis canvas. Everything the scanner "sees" happens at
// this size: 256px is enough to find the edges of a sheet of paper and cheap
// enough to do ~10x a second on a mid-range phone without heating it up.
const DETECT_WIDTH = 256;
// ~20 fps. Measured at the real geometry (256x455), one analysed frame costs
// ~1.5ms found / ~2.9ms searching on a laptop — call it 9-17ms on a mid-range
// phone, against a 50ms budget. The first version ran at 10fps on the
// assumption this was expensive; it is not, and the slower loop made both the
// outline and the motion reading worse.
const ANALYSIS_INTERVAL_MS = 50;
// ...but the OpenCV detector runs a full Canny + threshold + contour pass in
// WASM, which is a different order of cost on a phone than the hand-rolled
// TypeScript one. Detection is throttled to half the rate whenever it is the
// engine in charge, which is still 4x faster than the outline needs to look
// live. Everything the loop accumulates is measured in MILLISECONDS, so the
// shutter behaves identically at either rate.
const CV_ANALYSIS_INTERVAL_MS = 100;
// Accumulated DETECTION time before the shutter fires itself. Detection is the
// only gate (founder: "even if the camera is shaky it still takes a picture").
//
// 1200ms, not 500: at half a second the founder's verdict was "it takes the
// picture literally the second it lines up in frame" — technically correct and
// unpleasant to use. A capture needs a beat of deliberation so the client sees
// the outline lock, reads the ring filling, and feels the shot was decided
// rather than sprung on them. Still comfortably under the ~2s that would start
// to feel like waiting.
const DETECTED_MS_REQUIRED = 1200;
// Corner easing per analysed frame.
const SMOOTHING_ALPHA = 0.22;
// A detection whose corners land further than this (preview px) from the shown
// outline is a CLAIM, not a fact — it must persist before the outline moves.
const QUAD_JUMP_PX = 48;
const QUAD_ADOPT_FRAMES = 3;
// Corner movement below this (preview px) is noise, not the document moving.
// The detector reports a corner a pixel either side of the truth frame to
// frame; without a floor that redraws the outline 20x a second forever, which
// is what still read as "a bit buggy" after the big jumps were handled.
const QUAD_DEAD_ZONE_PX = 2.5;
// Coaching text: hold before speaking, speak briefly, then stay quiet about
// the same thing for a good while. "Looks good" is never spoken at all — the
// outline and the ring say it without words.
const HINT_SETTLE_MS = 500;
const HINT_LINGER_MS = 1800;
const HINT_COOLDOWN_MS = 6000;
// How long the OUTLINE survives a detection dropout before it disappears.
const MISS_GRACE_MS = 400;
// How long the shutter's CREDIT survives one. Much longer than the outline on
// purpose: on the founder's phone the detector flickered — found, lost for
// half a second, found again — with the document in frame the entire time,
// and credit dying with the outline turned a one-second capture into
// seventeen. The border may blink; the client's progress must not.
const CREDIT_HOLD_MS = 1500;
// Per-frame decay on the running sharpness peak (~0.6%/frame, so it halves
// over roughly 11 seconds at 10fps). Slow enough to hold a genuine focus
// reference, quick enough to follow the client moving to a new document.
const SHARPNESS_PEAK_DECAY = 0.994;
// Auto-capture debounce after a page is banked with "Add another page". The
// client is returned to the camera still pointing at the sheet they just
// shot, so the automatic shutter stays disarmed until at least this long has
// passed AND the scene visibly changed. See capture-arm.ts.
const REARM_MIN_DELAY_MS = 1500;
// Corner movement that counts as "they moved it", in PREVIEW px (converted to
// detect-canvas px at the call site, like the other outline constants above).
// The detector jitters a pixel or two frame to frame; 12 is comfortably past
// that and comfortably under a real page swap.
const REARM_MOVE_PX = 12;
// Continuous no-detection that counts as "the document left the frame".
const REARM_CLEAR_MISS_MS = 500;
// Charge fraction at which the outline commits from blue to green. The
// shutter starts accruing credit the instant a document is found, so without
// a threshold here the blue "detected" state would flash past unseen — the
// client would never get the two-stage read of lock-on, then commit.
const LOCK_PROGRESS = 0.4;

type Shot = {
  file: File;
  url: string;
  /** Advisory only — drives the review screen's "looks blurry" line. */
  blurry: boolean;
};

export function CameraCapture({
  onClose,
  onCapture,
  onChooseFile,
}: {
  onClose: () => void;
  /**
   * Hand the finished scan(s) to the caller's existing upload path. An array
   * because "Add another page" banks pages and hands them over together; the
   * portal's uploader already loops a File[] onto one checklist item, which is
   * the same path a client picking several photos at once has always taken.
   */
  onCapture: (files: File[]) => void;
  /** Escape hatch offered whenever the camera can't be used. */
  onChooseFile: () => void;
}) {
  const t = useTranslations("Portal");
  const camera = useCameraStream();
  const { start, stop, status, stream } = camera;

  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const shutterBoxRef = useRef<HTMLDivElement>(null);
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevGrayRef = useRef<Gray | null>(null);
  const quadRef = useRef<Quad | null>(null);
  const shutterRef = useRef<ShutterState>(INITIAL_SHUTTER);
  const stabilityRef = useRef<QuadStability>(INITIAL_QUAD_STABILITY);
  // The last quad actually pushed to React, by identity — see the dead zone.
  const lastShownRef = useRef<Quad | null>(null);
  // Rolling share of recent frames with a detection — purely for ?scan=debug,
  // where it turns "the border was buggy" into a number.
  const dutyRef = useRef(0);
  // Last capture problem, surfaced in ?scan=debug. A capture that fails
  // silently is invisible from the outside — this makes it one screenshot.
  const captureFallbackRef = useRef<string | null>(null);
  const shotCountRef = useRef(0);
  const peakSharpnessRef = useRef(0);
  const capturingRef = useRef(false);
  // Auto-shutter re-arm gate for the multi-page loop, and the last RAW
  // detection (detect-canvas coordinates) it compares against.
  const armRef = useRef<ArmState>(ARMED);
  const pagesRef = useRef(0);
  const rawQuadRef = useRef<Quad | null>(null);
  const debugRef = useRef<HTMLPreElement>(null);
  // Opt-in live readout: open the portal with ?scan=debug. Exists because the
  // shutter's gates are invisible from the outside — when it refuses to fire on
  // a real device, one screenshot of these numbers names the blocking metric
  // instead of another round of guessing.
  const debug = useSearchDebugFlag();

  const [view, setView] = useState({ width: 0, height: 0 });
  // How far down the stage the top controls reach, measured on mount/resize.
  const [controlsBottom, setControlsBottom] = useState(0);
  // How much of the stage BOTTOM the floating shutter occupies. Measured for
  // the same reason `controlsBottom` is: it sits above
  // env(safe-area-inset-bottom), which differs per device and cannot be
  // computed here. Without it the guide window would run underneath the
  // shutter on a tall phone.
  const [shutterTop, setShutterTop] = useState(0);
  const [quad, setQuad] = useState<Quad | null>(null);
  // What the client is actually being told right now — null most of the time.
  const [hint, setHint] = useState<Guidance | null>(null);
  const hintRef = useRef<HintState>(INITIAL_HINT);
  const [shot, setShot] = useState<Shot | null>(null);
  // Pages banked by "Add another page", uploaded together on Use.
  const [pages, setPages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  // 0..1 toward the next automatic photo. Always visible — the client should
  // never be looking at a screen that gives no sign anything is happening.
  const [progress, setProgress] = useState(0);

  // OpenCV.js + jscanify: ~13 MB of WASM that nobody who never scans should
  // pay for. Both live behind dynamic import()s (see opencv-loader), so the
  // download starts HERE — after the client tapped Scan — and never rides
  // along with the portal bundle. The camera comes up immediately regardless;
  // detection runs on the built-in TypeScript detector until (and if) the
  // engine lands, so a failure is a quieter scanner, never a broken one.
  const engineStatus = useSyncExternalStore(
    subscribeScanEngine,
    getScanEngineStatus,
    () => "idle" as const,
  );
  useEffect(() => {
    void loadScanEngine();
  }, []);

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
    const measure = () => {
      setView((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
      // Where the top controls actually end, measured rather than derived.
      // They sit below env(safe-area-inset-top), which differs per device and
      // cannot be computed here — and on a notched iPhone the frame's top
      // corners ended up underneath them.
      const stageBox = el.getBoundingClientRect();
      const stageTop = stageBox.top;
      const bottom = closeRef.current?.getBoundingClientRect().bottom;
      if (typeof bottom === "number") {
        const next = Math.max(0, Math.round(bottom - stageTop));
        setControlsBottom((prev) => (prev === next ? prev : next));
      }
      // Reserved room UNDER the guide window: everything from the shutter's
      // top edge to the bottom of the stage.
      const shutter = shutterBoxRef.current?.getBoundingClientRect().top;
      const reserved =
        typeof shutter === "number"
          ? Math.max(0, Math.round(stageBox.bottom - shutter))
          : 0;
      setShutterTop((prev) => (prev === reserved ? prev : reserved));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // `shot` and `failed` swap the controls out, so the reserved space below
    // the guide changes with them.
  }, [shot, status]);

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
      // Only crop when the DOCUMENT route reached the shutter. The safety net
      // fires without a trustworthy quad, so it must take the plain frame.
      const q = quadRef.current;
      let file: File | null = null;

      // Try the cropped-and-flattened capture, but NEVER let its failure mean
      // "no photo". This path reads a large frame back out of a canvas, which
      // is exactly what iOS refuses under memory pressure — and when it failed
      // the shutter fired, nothing appeared, the loop recharged and fired
      // again. Silent, endless, and indistinguishable from "auto-capture
      // doesn't work". A plain uncropped photo beats no photo every time.
      if (q && size.width > 0) {
        try {
          file = await captureVideoFrameRectified(video, q, size);
        } catch (e) {
          captureFallbackRef.current = (e as Error).message || "rectify_failed";
        }
      }
      if (!file) file = await captureVideoFrame(video, { view: size });

      shotCountRef.current += 1;
      // Focus advisory for the review screen. Never blocks and never delays
      // the picture appearing — a null measurement simply says nothing.
      const sharpness = await measureCaptureSharpness(
        file,
        REVIEW_SHARPNESS_WIDTH,
      );
      setShot({
        file,
        url: URL.createObjectURL(file),
        blurry: isReviewBlurry(sharpness),
      });
    } catch (e) {
      captureFallbackRef.current = (e as Error).message || "failed";
      setCaptureError("capture_failed");
    } finally {
      capturingRef.current = false;
      setBusy(false);
    }
  }, []);

  // The scanning loop. Draws the visible part of the frame into a small hidden
  // canvas, then hands plain pixel buffers to the pure analysis modules.
  // Deliberately keyed on [status, shot] ONLY. The preview size is read from a
  // ref inside the loop instead of being a dependency, because on a phone it
  // changes for all sorts of incidental reasons (browser chrome collapsing,
  // rotation, a keyboard dismissing) and every restart used to wipe the
  // shutter's run of good frames — so on a real device the photo never fired.
  useEffect(() => {
    if (status !== "ready" || shot) return;

    let raf = 0;
    let last = 0;
    let cancelled = false;

    const canvas =
      detectCanvasRef.current ?? document.createElement("canvas");
    detectCanvasRef.current = canvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    function tick(now: number) {
      if (cancelled) return;
      raf = requestAnimationFrame(tick);
      const engine = currentScanEngine();
      const interval = engine ? CV_ANALYSIS_INTERVAL_MS : ANALYSIS_INTERVAL_MS;
      if (now - last < interval) return;
      const elapsedMs = last === 0 ? interval : now - last;
      last = now;

      const video = videoRef.current;
      // HAVE_CURRENT_DATA — anything less and getImageData reads black.
      if (!ctx || !video || video.readyState < 2) return;

      const view = viewRef.current;
      if (view.width <= 0 || view.height <= 0) return;

      // Resize the analysis canvas in step with the preview rather than on
      // effect setup, so a viewport change adjusts the next frame instead of
      // restarting the loop.
      const wanted = Math.max(
        1,
        Math.round((DETECT_WIDTH * view.height) / view.width),
      );
      if (canvas.width !== DETECT_WIDTH || canvas.height !== wanted) {
        canvas.width = DETECT_WIDTH;
        canvas.height = wanted;
        prevGrayRef.current = null;
      }

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

      // jscanify/OpenCV when the engine is up, the built-in detector when it
      // is not. Both return the same thing — a plausibility-checked quad in
      // detect-canvas coordinates, or null — so everything below (outline
      // hysteresis, the shutter, the hints) is unchanged either way.
      const found = engine
        ? detectQuadCv(engine, {
            data: rgba.data,
            width: rgba.width,
            height: rgba.height,
          })
        : detectQuad(gray);
      rawQuadRef.current = found;
      dutyRef.current = dutyRef.current * 0.94 + (found ? 0.06 : 0);

      // Hysteresis, not just easing: on a real phone the detector flips
      // between rival readings of the same scene, and chasing every flip is
      // what the founder saw as the border "snapping back and forth". The
      // shown outline glides for nearby updates and ignores far ones until
      // they persist.
      stabilityRef.current = stabiliseQuad(stabilityRef.current, found, {
        alpha: SMOOTHING_ALPHA,
        jumpDistance: (QUAD_JUMP_PX * canvas.width) / view.width,
        adoptAfter: QUAD_ADOPT_FRAMES,
        deadZone: (QUAD_DEAD_ZONE_PX * canvas.width) / view.width,
      });
      const smoothed = stabilityRef.current.shown;

      const areaFraction = smoothed
        ? quadArea(smoothed) / (canvas.width * canvas.height)
        : null;

      const metrics = computeMetrics(gray, prevGrayRef.current, areaFraction);
      prevGrayRef.current = gray;

      // Judge focus against the sharpest frame this camera has managed on this
      // scene, not against a constant. Variance of the Laplacian has no
      // device-independent scale, and a fixed number set too high is exactly
      // what stopped the shutter arming on a real phone. Decays slowly so a
      // peak set by one lucky frame doesn't gate the rest of the session.
      peakSharpnessRef.current = Math.max(
        peakSharpnessRef.current * SHARPNESS_PEAK_DECAY,
        metrics.sharpness,
      );

      // All the frame-to-frame bookkeeping — how long the document has looked
      // good, how long it has been missing, whether to shoot — lives in a pure
      // reducer so it can actually be tested. This loop only does the parts
      // that need a canvas.
      // Motion is a per-interval difference, so it has to be rescaled before
      // it meets a fixed threshold — otherwise the same steady hand reads
      // twice as high at 10fps as at 20fps and "Hold steady" never clears.
      const judged = {
        ...metrics,
        motion: normaliseMotion(metrics.motion, elapsedMs),
      };

      // Steadiness for the safety net, judged on the rate-normalised motion so
      // it means the same thing at any loop speed.

      const step = advanceShutter(shutterRef.current, {
        // Raw detection presence, not the stabilised outline — the outline
        // deliberately persists through dropouts, and crediting that would
        // let the shutter charge on a ghost.
        detected: found !== null,
        guidanceFor: (documentPresent) =>
          guidanceFor(judged, documentPresent, {
            minSharpness: sharpnessFloorFor(peakSharpnessRef.current),
          }),
        elapsedMs,
        graceMs: MISS_GRACE_MS,
        creditHoldMs: CREDIT_HOLD_MS,
        requiredDetectedMs: DETECTED_MS_REQUIRED,
      });
      shutterRef.current = step.state;

      if (debug && debugRef.current) {
        const floor = sharpnessFloorFor(peakSharpnessRef.current);
        const th = GUIDANCE_THRESHOLDS;
        debugRef.current.textContent = [
          `fps    ${(1000 / Math.max(1, elapsedMs)).toFixed(0)}  (${elapsedMs.toFixed(0)}ms)`,
          `light  ${judged.luminance.toFixed(0).padStart(5)}  need >${th.minLuminance}   ${judged.luminance < th.minLuminance ? "FAIL" : "ok"}`,
          `motion ${judged.motion.toFixed(1).padStart(5)}  need <${th.maxMotion}    ${judged.motion > th.maxMotion ? "FAIL" : "ok"}`,
          `sharp  ${judged.sharpness.toFixed(0).padStart(5)}  need >${floor.toFixed(0)}   ${judged.sharpness < floor ? "FAIL" : "ok"}`,
          `fill   ${judged.fill.toFixed(2).padStart(5)}  need >${th.minFill}  ${judged.fill < th.minFill ? "FAIL" : "ok"}`,
          `quad   ${found ? "found" : "NONE"}  duty ${(dutyRef.current * 100).toFixed(0)}%`,
          `hint   ${step.guidance}`,
          `charge ${(step.progress * 100).toFixed(0)}%  (${step.state.detectedMs.toFixed(0)}/${DETECTED_MS_REQUIRED}ms, miss ${step.state.missMs.toFixed(0)})`,
          `engine ${engine ? "opencv" : getScanEngineStatus() === "loading" ? "loading (builtin)" : "builtin"}  ${armRef.current.armed ? "armed" : "disarmed"}${getScanEngineError() ? `  ERR: ${getScanEngineError()}` : ""}`,
          `pages  ${pagesRef.current}`,
          `shots  ${shotCountRef.current}${captureFallbackRef.current ? `  LAST ERR: ${captureFallbackRef.current}` : ""}`,
        ].join("\n");
      }

      const hintStep = advanceHint(hintRef.current, {
        guidance: step.guidance,
        elapsedMs,
        settleMs: HINT_SETTLE_MS,
        lingerMs: HINT_LINGER_MS,
        cooldownMs: HINT_COOLDOWN_MS,
      });
      hintRef.current = hintStep.state;
      setHint((h) => (h === hintStep.visible ? h : hintStep.visible));

      if (step.outline === "update" && smoothed) {
        // `stabiliseQuad` returns the SAME object when the change was inside
        // the dead zone, so identity is a reliable "nothing moved" signal —
        // skip the state update and the outline simply stays put.
        if (smoothed !== lastShownRef.current) {
          lastShownRef.current = smoothed;
          const inView = scaleToView(smoothed, view, canvas);
          quadRef.current = inView;
          setQuad(inView);
        }
      } else if (step.outline === "clear") {
        quadRef.current = null;
        lastShownRef.current = null;
        setQuad(null);
        stabilityRef.current = INITIAL_QUAD_STABILITY;
      }

      // Drive the ring. Written straight to state at ~20fps; it is one number
      // and the ring is a single SVG circle.
      setProgress((p) => (Math.abs(p - step.progress) < 0.01 ? p : step.progress));

      // The automatic shutter is disarmed for a beat after a page is banked,
      // so returning to the camera over the sheet that was just photographed
      // cannot fire again on it. The manual button is never gated.
      armRef.current = advanceArm(armRef.current, {
        quad: found,
        elapsedMs,
        minDelayMs: REARM_MIN_DELAY_MS,
        moveTolerancePx: (REARM_MOVE_PX * canvas.width) / view.width,
        clearMissMs: REARM_CLEAR_MISS_MS,
      });

      if (step.fire && armRef.current.armed) void capture();
    }

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      prevGrayRef.current = null;
      // NB: the shutter state deliberately survives a teardown. Resetting it
      // here meant any incidental restart threw away the run of good frames.
    };
  }, [status, shot, capture, debug]);

  // Back to the camera, keeping any banked pages. Deliberately does NOT
  // disarm the auto-shutter: a client who rejected a shot wants that same
  // document captured again, right away.
  function retake() {
    setShot(null);
    setCaptureError(null);
    shutterRef.current = INITIAL_SHUTTER;
    hintRef.current = INITIAL_HINT;
    setHint(null);
    peakSharpnessRef.current = 0;
    setProgress(0);
    quadRef.current = null;
    setQuad(null);
  }

  // Bank the page on screen and go back for the next one. The auto-shutter is
  // disarmed until the scene changes, because the camera is about to be
  // pointing at the sheet that was just captured.
  function addPage() {
    if (!shot) return;
    setPages((prev) => {
      const next = [...prev, shot.file];
      pagesRef.current = next.length;
      return next;
    });
    armRef.current = disarm(rawQuadRef.current);
    retake();
  }

  // Everything banked, plus what is on screen, in the order they were taken.
  //
  // One call with every page: the portal's uploader loops a File[] onto this
  // one checklist item, which is exactly what a client picking several photos
  // at once has always done. It does NOT stitch them into a single PDF —
  // nothing in the upload pipeline assembles multi-page documents today, so
  // the pages arrive as separate files attached to the same item.
  function useShot() {
    if (!shot) return;
    onCapture([...pages, shot.file]);
    onClose();
  }

  const failed =
    status === "denied" || status === "error" || status === "unavailable";

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("scan_title")}
      className="fixed inset-0 z-[70] flex flex-col bg-black"
    >
      {/* Stage — camera preview, or the captured shot on white. */}
      <div
        ref={stageRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden",
          shot || failed ? "bg-white" : "bg-black",
        )}
      >
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
          <div className="absolute inset-0 flex items-center justify-center p-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shot.url}
              alt={t("scan_review_alt")}
              className="max-h-full max-w-full rounded-lg object-contain shadow-[0_1px_3px_rgba(0,0,0,0.10),0_8px_24px_rgba(0,0,0,0.08)]"
            />
          </div>
        )}

        {!shot && !failed && (
          <ScanOverlay
            view={view}
            quad={quad}
            locked={progress >= LOCK_PROGRESS}
            topInset={controlsBottom}
            bottomInset={shutterTop}
          />
        )}

        {status === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="size-7 animate-spin text-white/60" aria-hidden />
          </div>
        )}

        {failed && <CameraUnavailable code={camera.error ?? "camera_failed"} />}

        {/* Coaching, when there is genuinely something to say. It fades in,
            sits for a moment and fades out — advice you have already read is
            noise. Kept mounted so the fade-out can play; aria-live still
            announces it once, and only when it appears. */}
        {!shot && !failed && status === "ready" && (
          <div
            className="pointer-events-none absolute inset-x-0 flex justify-center px-8"
            style={{
              bottom: "calc(env(safe-area-inset-bottom, 0px) + 7.25rem)",
            }}
          >
            <p
              aria-live="polite"
              className={cn(
                "text-center text-[13px] font-normal leading-snug text-white/75 [text-shadow:0_1px_3px_rgba(0,0,0,0.6)] transition-opacity duration-500",
                hint ? "opacity-100" : "opacity-0",
              )}
            >
              {hint ? t(`scan_hint_${hint}`) : "\u00a0"}
            </p>
          </div>
        )}

        {/* The engine downloads in the background while the camera is already
            live and already detecting on the built-in detector, so this says
            "getting better", not "wait". It disappears either way. */}
        {!shot && !failed && engineStatus === "loading" && (
          <div
            className="pointer-events-none absolute inset-x-0 flex justify-center px-6"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 4.5rem)" }}
          >
            <p className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[12px] font-medium text-white/90">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {t("scan_preparing")}
            </p>
          </div>
        )}

        {/* How many pages are already banked. Only ever shown once there is at
            least one, so the ordinary single-page scan is untouched. */}
        {pages.length > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 flex justify-center px-6"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 1.35rem)" }}
          >
            <p className="rounded-full bg-black/55 px-3 py-1.5 text-[12px] font-medium text-white/90">
              {t("scan_pages_banked", { count: pages.length })}
            </p>
          </div>
        )}

        {/* Focus advisory. Non-blocking by design: it is a hint next to a
            Retake button the client can ignore, and the server-side AI check
            remains the real gate on an unusable file. */}
        {shot?.blurry && (
          <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-6">
            <p className="rounded-full bg-amber-100 px-3.5 py-1.5 text-[13px] font-medium text-amber-900 shadow-sm ring-1 ring-amber-200">
              {t("scan_blurry_warning")}
            </p>
          </div>
        )}

        {debug && !shot && (
          <pre
            ref={debugRef}
            className="pointer-events-none absolute left-3 top-24 z-10 whitespace-pre rounded bg-black/75 px-2 py-1.5 font-mono text-[10px] leading-tight text-green-300"
          />
        )}

        {captureError && (
          <div
            className="pointer-events-none absolute inset-x-0 flex justify-center px-6"
            style={{
              bottom: "calc(env(safe-area-inset-bottom, 0px) + 7.25rem)",
            }}
          >
            <p className="rounded-full bg-red-600 px-3.5 py-1.5 text-[13px] font-medium text-white shadow-sm">
              {t("errors.capture_failed")}
            </p>
          </div>
        )}

        {/* Close, and torch where the device has one. White discs so they read
            the same over a bright document or a dark table. */}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("scan_close")}
          className="absolute right-4 inline-flex size-11 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white ring-1 ring-white/25 backdrop-blur-sm transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-0"
          style={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
        >
          <X className="size-[18px]" aria-hidden />
        </button>

        {/* The shutter, floating over the preview. Sits above the safe-area
            inset so iOS Safari's own bottom bar cannot land on top of it, and
            the guide window measures this element to keep clear of it. */}
        {!shot && !failed && (
          <div
            ref={shutterBoxRef}
            className="absolute inset-x-0 flex justify-center"
            style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
          >
            <div className="relative inline-flex size-[76px] items-center justify-center">
              {/* The ring. Fills as the scanner works toward taking the photo,
                  so the client is never looking at a screen that gives no sign
                  anything is happening — and, when it stalls, WHERE it stalled
                  is visible without a debug flag. */}
              <ShutterRing progress={status === "ready" && !busy ? progress : 0} />
              <button
                type="button"
                onClick={() => void capture()}
                disabled={status !== "ready" || busy}
                aria-label={t("scan_capture")}
                className="inline-flex size-[62px] cursor-pointer items-center justify-center rounded-full bg-[#1050ed] text-white shadow-[0_2px_12px_rgba(0,0,0,0.45)] ring-[3px] ring-white/90 transition-colors hover:bg-[#0d43c8] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white disabled:cursor-default disabled:bg-white/25 disabled:text-white/60 disabled:ring-white/40 motion-safe:active:scale-95"
              >
                {busy ? (
                  <Loader2 className="size-6 animate-spin" aria-hidden />
                ) : (
                  <Camera className="size-6" aria-hidden />
                )}
              </button>
            </div>
          </div>
        )}

        {camera.torchSupported && !shot && !failed && (
          <button
            type="button"
            onClick={camera.toggleTorch}
            aria-label={t("scan_torch")}
            aria-pressed={camera.torchOn}
            className={cn(
              "absolute left-4 inline-flex size-11 cursor-pointer items-center justify-center rounded-full backdrop-blur-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-0",
              camera.torchOn
                ? "bg-white text-neutral-900 ring-1 ring-white"
                : "bg-black/40 text-white ring-1 ring-white/25 hover:bg-black/55",
            )}
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
          >
            <Flashlight className="size-[18px]" aria-hidden />
          </button>
        )}
      </div>

      {/* Review and error only. The LIVE camera has no bar at all — its shutter
          floats over the picture (see the stage above), because a white slab
          under a camera view is the thing that read as "off": it boxed the
          preview into the top two thirds and left a big empty tray beneath a
          small button. Every scanning app worth copying runs the camera to all
          four edges. */}
      <div
        className={cn(
          "shrink-0 items-center justify-center gap-3 border-t border-neutral-200/80 bg-white px-6 pt-5",
          shot || failed ? "flex" : "hidden",
        )}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        {shot ? (
          // Two rows at 375px: three actions cannot share one line without
          // truncating "Use this photo", which is the one that must stay
          // readable. The primary sits alone underneath, full width.
          <div className="flex w-full flex-col gap-2.5">
            <div className="flex items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={retake}
                className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border border-neutral-300 px-4 py-3 text-[15px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1050ed] focus-visible:ring-offset-2"
              >
                <RotateCcw className="size-4" aria-hidden />
                {t("scan_retake")}
              </button>
              <button
                type="button"
                onClick={addPage}
                className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full border border-neutral-300 px-4 py-3 text-[15px] font-medium text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1050ed] focus-visible:ring-offset-2"
              >
                <CopyPlus className="size-4" aria-hidden />
                {t("scan_add_page")}
              </button>
            </div>
            <button
              type="button"
              onClick={useShot}
              className="inline-flex w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#1050ed] px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#0d43c8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1050ed] focus-visible:ring-offset-2"
            >
              <Check className="size-4" aria-hidden />
              {t("scan_use")}
            </button>
          </div>
        ) : failed ? (
          <button
            type="button"
            onClick={() => {
              onChooseFile();
              onClose();
            }}
            className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#1050ed] px-6 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#0d43c8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1050ed] focus-visible:ring-offset-2"
          >
            <ImageUp className="size-4" aria-hidden />
            {t("scan_choose_file")}
          </button>
        ) : null}
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

/**
 * Progress toward the automatic photo, drawn as a ring around the shutter.
 *
 * Deliberately plain SVG with a stroke-dashoffset — no library, no per-frame
 * JavaScript. The CSS transition carries it smoothly between the ~20 updates a
 * second the scanner produces.
 */
function ShutterRing({ progress }: { progress: number }) {
  const R = 35.5;
  const C = 2 * Math.PI * R;
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full -rotate-90"
      viewBox="0 0 76 76"
      aria-hidden
    >
      {/* Track. Barely-there white rather than pale blue: over a live camera
          the old tint read as a glow bleeding off the button, not as a ring
          waiting to be filled. */}
      <circle
        cx="38"
        cy="38"
        r={R}
        fill="none"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth={3}
      />
      {/* Fill. Green, matching the outline's locked state, so one colour means
          one thing across the whole screen: the shot is being taken. */}
      <circle
        cx="38"
        cy="38"
        r={R}
        fill="none"
        stroke="#22c55e"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - p)}
        className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-100"
      />
    </svg>
  );
}

/** Corner brackets plus the live document outline. */
function ScanOverlay({
  view,
  quad,
  locked,
  topInset,
  bottomInset,
}: {
  view: { width: number; height: number };
  quad: Quad | null;
  /** The shutter has charged past LOCK_PROGRESS — the outline commits. */
  locked: boolean;
  topInset: number;
  bottomInset: number;
}) {
  if (view.width <= 0 || view.height <= 0) return null;
  const a = apertureFor(view, { top: topInset, bottom: bottomInset });
  const arm = Math.round(Math.min(a.width, a.height) * 0.11);

  // Outer rect + inner rounded rect as one evenodd path: the inner subpath is
  // punched out, dimming everything except the document window. Cheaper and
  // crisper than four positioned divs, and it scales with the viewport.
  const scrim = `M0 0 H${view.width} V${view.height} H0 Z ${roundedRectPath(a)}`;

  const corners = [
    `M ${a.x} ${a.y + arm} V ${a.y + a.r} A ${a.r} ${a.r} 0 0 1 ${a.x + a.r} ${a.y} H ${a.x + arm}`,
    `M ${a.x + a.width - arm} ${a.y} H ${a.x + a.width - a.r} A ${a.r} ${a.r} 0 0 1 ${a.x + a.width} ${a.y + a.r} V ${a.y + arm}`,
    `M ${a.x + a.width} ${a.y + a.height - arm} V ${a.y + a.height - a.r} A ${a.r} ${a.r} 0 0 1 ${a.x + a.width - a.r} ${a.y + a.height} H ${a.x + a.width - arm}`,
    `M ${a.x + arm} ${a.y + a.height} H ${a.x + a.r} A ${a.r} ${a.r} 0 0 1 ${a.x} ${a.y + a.height - a.r} V ${a.y + a.height - arm}`,
  ];

  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${view.width} ${view.height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={scrim} fillRule="evenodd" fill="rgba(0,0,0,0.5)" />

      {/* Thin brackets marking where to put the document. They step back once
          the document itself is outlined — two competing frames reads as
          clutter. */}
      <g
        className="transition-opacity duration-300"
        opacity={quad ? 0.2 : 0.9}
        stroke="white"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        {corners.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {/* Two states, and the colour is the whole message. Brand blue while the
          scanner is TRACKING a document (white would vanish against the paper
          it is drawn on), green once the shot is COMMITTED and the ring is
          filling — the client can see the difference between "I can see it"
          and "I am about to take it" without reading a word.

          Rendered the PLAIN way — React writes `points` on every detection
          (~20x a second, eased by smoothQuad). A fancier version interpolated
          the outline imperatively at display rate; it looked lovely in the
          test browser and the border VANISHED on the founder's iPhone. This is
          the exact mechanism from the build they saw working, kept dumb on
          purpose. Reliability > silk. */}
      {quad && (
        <polygon
          points={quad.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          className="transition-[fill,stroke,stroke-width] duration-200"
          // Barely-there fill on lock, none before it: a strong wash over the
          // page hides the very thing the client is checking.
          fill={locked ? "rgba(22,163,74,0.10)" : "none"}
          stroke={locked ? "#16a34a" : "rgba(16,80,237,0.85)"}
          strokeWidth={locked ? 3.5 : 2.5}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/**
 * True when the page was opened with ?scan=debug. Read through
 * useSyncExternalStore so the server renders nothing and the client decides —
 * the two can't disagree during hydration.
 */
function useSearchDebugFlag(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => {
      try {
        return new URLSearchParams(window.location.search).get("scan") === "debug";
      } catch {
        return false;
      }
    },
    () => false,
  );
}

const subscribeNever = () => () => {};



/**
 * Shown whenever the camera can't be used. Explains what happened and, for a
 * denial, how to undo it — the way back to the ordinary file picker lives in
 * the control bar below, so it is not repeated here.
 */
function CameraUnavailable({ code }: { code: CameraErrorCode }) {
  const t = useTranslations("Portal");
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div className="max-w-xs space-y-2.5 text-center">
        <Camera className="mx-auto size-7 text-neutral-400" aria-hidden />
        <p className="text-[15px] font-medium text-neutral-900">
          {t(`errors.${code}`)}
        </p>
        {code === "camera_denied" && (
          <p className="text-[13px] leading-relaxed text-neutral-500">
            {t("scan_denied_help")}
          </p>
        )}
      </div>
    </div>
  );
}

// --- framing geometry -------------------------------------------------------

type Aperture = {
  x: number;
  y: number;
  width: number;
  height: number;
  r: number;
};

/**
 * The clear window in the scrim: where we're asking the client to put the
 * document. Portrait letter proportions, because the slips this collects (T4,
 * RL-1 and friends) are portrait — sized to the viewport so it stays a guide
 * rather than a hard boundary, since detection works anywhere in frame.
 */
/**
 * Room kept clear under the window for the coaching line. A FLOOR, not the
 * whole story — the caller also passes what the floating shutter occupies,
 * and the larger of the two wins (see apertureFor).
 */
const HINT_CLEARANCE = 64;
/** Gap between the top controls and the window's top edge. */
const CONTROL_GAP = 12;
/**
 * Share of the camera frame the guide asks the client to fill, and the guide's
 * own aspect ratio. The share is the load-bearing one — see apertureFor.
 */
const APERTURE_FRAME_SHARE = 0.42;
const APERTURE_RATIO = 1.4;

export function apertureFor(
  view: { width: number; height: number },
  /**
   * `top` is how far down the stage the close/torch buttons reach, and
   * `bottom` is how much of the stage the floating shutter occupies. Both are
   * measured by the caller: they sit against the device's safe-area insets,
   * which differ per device and cannot be computed here. On a notched iPhone
   * the window's top corners rendered underneath the buttons before `top`
   * existed; `bottom` is the same bug waiting at the other end, now that the
   * camera runs full-bleed and the shutter floats over it.
   */
  insets: { top?: number; bottom?: number } = {},
): Aperture {
  const margin = Math.round(view.width * 0.05);
  const maxWidth = Math.max(1, view.width - margin * 2);

  const topClearance =
    Math.max(0, Number.isFinite(insets.top) ? (insets.top as number) : 0) +
    CONTROL_GAP;

  // Never less than the coaching line needs, whatever the controls report.
  const bottomClearance = Math.max(
    HINT_CLEARANCE,
    (Number.isFinite(insets.bottom) ? (insets.bottom as number) : 0) +
      CONTROL_GAP,
  );

  // Documents are tall rectangles, so the window is too — but its SIZE is not
  // a taste decision, it is set by what the detector can actually see.
  //
  // Measured: the detector finds the document 100% of the time while the page
  // (tilted) still fits entirely inside the camera frame, and 0% the moment
  // one corner crosses the edge. It cannot locate a corner that is not in the
  // picture. Hit rate against page-area-as-a-share-of-frame:
  //
  //     share   0deg   6deg   14deg   25deg
  //     0.25    100%   100%    100%    100%
  //     0.35    100%   100%    100%     78%
  //     0.45    100%   100%     19%      0%
  //     0.65    100%     0%      0%      0%
  //
  // A window at two thirds of the screen therefore INSTRUCTS the client into
  // the dead zone: they fill it, tilt a few degrees as anyone does hand-held,
  // a corner leaves the frame and detection stops. That is what produced "the
  // outline only got detected about ten percent of the time" — and, earlier,
  // "you have to move the camera far back", which was the same constraint felt
  // from the other side.
  //
  // The share is then the LARGEST one that still holds detection through a
  // normal hand's tilt, because every point of share is a step closer the
  // client gets to hold the phone — and closer means more pixels on the page.
  // Swept at finer angles:
  //
  //     share   0deg   4deg   8deg   12deg   16deg
  //     0.34    100%   100%   100%    100%    100%
  //     0.42    100%   100%   100%    100%    100%
  //     0.46    100%   100%   100%    100%      0%
  //     0.50    100%   100%   100%      0%      0%
  //
  // 0.42 keeps the full 16-degree margin; 0.46 is already on the cliff edge.
  const targetArea = view.width * view.height * APERTURE_FRAME_SHARE;
  const wanted = Math.min(
    Math.sqrt(targetArea * APERTURE_RATIO),
    // Never wider than the margins allow, whatever the share works out to.
    maxWidth * APERTURE_RATIO,
  );
  const room = Math.max(1, view.height - topClearance - bottomClearance);
  const height = Math.max(1, Math.round(Math.min(wanted, room)));
  const width = Math.max(1, Math.round(Math.min(height / APERTURE_RATIO, maxWidth)));

  // Nudged above centre: the eye reads the frame as balanced when the gap
  // below it (which carries the hint) is a little larger than the gap above.
  const centred = Math.round((view.height - height) / 2 - view.height * 0.03);
  const lowest = view.height - height - bottomClearance;
  const y = Math.max(topClearance, Math.min(centred, Math.max(topClearance, lowest)));

  return {
    x: Math.round((view.width - width) / 2),
    y: Math.max(0, y),
    width,
    height,
    r: 14,
  };
}

function roundedRectPath({ x, y, width, height, r }: Aperture): string {
  const rad = Math.min(r, width / 2, height / 2);
  return [
    `M ${x + rad} ${y}`,
    `H ${x + width - rad}`,
    `A ${rad} ${rad} 0 0 1 ${x + width} ${y + rad}`,
    `V ${y + height - rad}`,
    `A ${rad} ${rad} 0 0 1 ${x + width - rad} ${y + height}`,
    `H ${x + rad}`,
    `A ${rad} ${rad} 0 0 1 ${x} ${y + height - rad}`,
    `V ${y + rad}`,
    `A ${rad} ${rad} 0 0 1 ${x + rad} ${y}`,
    "Z",
  ].join(" ");
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


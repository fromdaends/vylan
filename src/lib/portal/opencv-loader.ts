// Lazily brings up the OpenCV.js + jscanify scan engine for the portal
// scanner, and never lets its weight or its failure touch anyone else.
//
// OpenCV.js is a ~13 MB WASM build. It must NEVER ride along with the portal
// bundle: both packages are reached only through the dynamic import()s below,
// so they compile into their own async chunks, fetched the first time a client
// actually opens the scanner (CameraCapture mounts on the Scan tap and calls
// loadScanEngine). Served from /_next/static those chunks carry content-hashed
// names and immutable cache headers, so the download happens once per device.
//
// Failure is a supported outcome, not an error: on an old device, blocked
// WASM or a dead network, loadScanEngine resolves null, the status flips to
// "failed", and the scanner keeps running on the built-in TypeScript detector
// (detect-quad.ts) exactly as it shipped before OpenCV existed here. Scanning
// is never less capable than it was.

import type { JscanifyCornerPoints } from "jscanify/client";

/** The one cv.Mat behaviour we manage ourselves: freeing WASM-heap memory. */
export type CvMat = { delete(): void };

/**
 * The slice of OpenCV.js this codebase is allowed to touch. jscanify reaches
 * the global `cv` itself for everything else, so keeping this narrow keeps
 * accidental OpenCV coupling out of the rest of the scanner.
 */
export type CvRuntime = {
  Mat: unknown;
  matFromImageData(data: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
  }): CvMat;
};

/** jscanify's surface, matching src/types/jscanify-client.d.ts. */
export type PaperScanner = {
  findPaperContour(mat: unknown): CvMat | null;
  getCornerPoints(contour: unknown, mat?: unknown): JscanifyCornerPoints;
  extractPaper(
    image: unknown,
    resultWidth: number,
    resultHeight: number,
    cornerPoints?: JscanifyCornerPoints,
  ): HTMLCanvasElement | null;
};

export type ScanEngine = { cv: CvRuntime; scanner: PaperScanner };

export type ScanEngineStatus = "idle" | "loading" | "ready" | "failed";

// After this long the "Préparation du scanner…" pill gives up and the status
// reads failed — the client is on the fallback detector and there is nothing
// more to announce. The download itself is NOT cancelled: a slow connection
// that eventually delivers still upgrades detection mid-session.
const LOAD_TIMEOUT_MS = 45_000;

let statusValue: ScanEngineStatus = "idle";
// Why the last load failed. Kept because a swallowed failure is invisible
// from the outside — this turns "detection feels worse on my phone" into one
// screenshot of the ?scan=debug readout instead of a guessing round.
let lastErrorValue: string | null = null;
let engineValue: ScanEngine | null = null;
let enginePromise: Promise<ScanEngine | null> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: ScanEngineStatus): void {
  if (statusValue === next) return;
  statusValue = next;
  listeners.forEach((l) => l());
}

/** Snapshot for useSyncExternalStore. */
export function getScanEngineStatus(): ScanEngineStatus {
  return statusValue;
}

/** Why the last load failed, for the ?scan=debug readout. */
export function getScanEngineError(): string | null {
  return lastErrorValue;
}

export function subscribeScanEngine(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The engine, if it has finished loading — read per-frame by the detection
 * loop through this plain getter precisely so the loop's effect does not have
 * to depend on React state (a re-render mid-scan restarts the loop and used
 * to wipe the auto-shutter's progress; see camera-capture.tsx).
 */
export function currentScanEngine(): ScanEngine | null {
  return engineValue;
}

/**
 * OpenCV.js is an Emscripten MODULARIZE build and its export shape has varied
 * across versions: a Promise of the module, an object with a `.ready` Promise,
 * or an object that announces itself via `onRuntimeInitialized`. Resolve all
 * three to the initialised module.
 */
async function resolveCvModule(candidate: unknown): Promise<unknown> {
  let cv = candidate as {
    then?: unknown;
    ready?: { then?: unknown };
    Mat?: unknown;
    onRuntimeInitialized?: (() => void) | undefined;
  } | null;
  if (cv && typeof cv.then === "function") {
    cv = (await cv) as typeof cv;
  }
  if (cv && cv.ready && typeof cv.ready.then === "function") {
    const ready = (await cv.ready) as typeof cv | undefined;
    cv = ready ?? cv;
  }
  if (cv && !cv.Mat && "onRuntimeInitialized" in cv) {
    await new Promise<void>((resolve) => {
      // The runtime may already be up (the hook fires exactly once) — poll as
      // a backstop so a missed callback degrades to a short wait, not a hang.
      const timer = setInterval(() => {
        if ((cv as { Mat?: unknown }).Mat) finish();
      }, 250);
      const cutoff = setTimeout(finish, 20_000);
      const prev = cv?.onRuntimeInitialized;
      function finish() {
        clearInterval(timer);
        clearTimeout(cutoff);
        resolve();
      }
      if (cv) {
        cv.onRuntimeInitialized = () => {
          prev?.();
          finish();
        };
      } else {
        finish();
      }
    });
  }
  return cv;
}

function isUsableCv(cv: unknown): cv is CvRuntime {
  return (
    typeof cv === "object" &&
    cv !== null &&
    "Mat" in cv &&
    typeof (cv as { matFromImageData?: unknown }).matFromImageData === "function"
  );
}

async function loadEngine(): Promise<ScanEngine> {
  // NB: opencv is reached through ./opencv-module, never imported directly —
  // a direct dynamic import of the package throws before our code runs. See
  // the comment at the top of that file; it is not a style choice.
  const [cvMod, jsMod] = await Promise.all([
    import("./opencv-module"),
    import("jscanify/client"),
  ]);
  const cv = await resolveCvModule(cvMod.getCvModule());
  if (!isUsableCv(cv)) throw new Error("opencv_unusable");

  // jscanify reads the bare global `cv` inside its methods — publish the
  // initialised module before the first call ever happens.
  (globalThis as { cv?: unknown }).cv = cv;

  const Ctor = ((jsMod as { default?: unknown }).default ??
    jsMod) as new () => PaperScanner;
  return { cv, scanner: new Ctor() };
}

/**
 * Idempotent: the first call starts the download, every later call returns the
 * same promise. Resolves null on failure — callers treat null as "keep using
 * the fallback detector", never as an error to surface.
 */
export function loadScanEngine(): Promise<ScanEngine | null> {
  if (enginePromise) return enginePromise;
  if (typeof window === "undefined") return Promise.resolve(null);

  setStatus("loading");
  const timer = setTimeout(() => {
    if (statusValue === "loading") setStatus("failed");
  }, LOAD_TIMEOUT_MS);

  enginePromise = loadEngine()
    .then((engine) => {
      engineValue = engine;
      // A load that outlived the pill's patience still counts: detection
      // silently upgrades the moment the engine lands.
      setStatus("ready");
      return engine;
    })
    .catch((e: unknown) => {
      lastErrorValue = (e as Error)?.message || String(e) || "unknown";
      setStatus("failed");
      return null;
    })
    .finally(() => clearTimeout(timer));
  return enginePromise;
}

/** Test-only: drive the status without touching the real WASM package. */
export function __setScanEngineStatusForTests(next: ScanEngineStatus): void {
  setStatus(next);
}

/** Test-only: forget the module-level singleton between cases. */
export function __resetScanEngineForTests(): void {
  statusValue = "idle";
  lastErrorValue = null;
  engineValue = null;
  enginePromise = null;
  listeners.clear();
  delete (globalThis as { cv?: unknown }).cv;
}

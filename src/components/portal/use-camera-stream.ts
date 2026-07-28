"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Owns the getUserMedia lifecycle for the portal scanner: acquiring the rear
// camera, classifying failures into something we can say to a client in plain
// language, and — the part that actually bites — making absolutely sure the
// stream is released. A leaked MediaStream leaves the phone's camera light on
// after the overlay closes, which reads as spyware.

export type CameraStatus =
  | "idle"
  | "starting"
  | "ready"
  | "denied"
  | "unavailable"
  | "error";

/** Error codes; each has a matching Portal.errors.<code> string in en/fr. */
export type CameraErrorCode =
  | "camera_denied"
  | "camera_not_found"
  | "camera_busy"
  | "camera_unsupported"
  | "camera_failed";

/**
 * Whether this browser can even attempt a live camera. False on http:// over a
 * LAN IP (getUserMedia is secure-context only), on old browsers, and under the
 * test DOM — the caller uses this to decide whether to offer "Scan" at all,
 * rather than offering a button that always fails.
 */
export function isCameraSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

/** DOMException name -> the code whose message we show. */
export function classifyCameraError(err: unknown): CameraErrorCode {
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  switch (name) {
    case "NotAllowedError":
    // Older Firefox/Safari spelling of the same thing.
    case "PermissionDeniedError":
      return "camera_denied";
    // Thrown when Permissions-Policy blocks the call outright: the client
    // never saw a prompt, so "you denied it" would be a lie. This is also the
    // signal that the header rule regressed.
    case "SecurityError":
      return "camera_unsupported";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "camera_not_found";
    // Camera exists but another app (or another tab) holds it.
    case "NotReadableError":
    case "TrackStartError":
      return "camera_busy";
    default:
      return "camera_failed";
  }
}

function stopStream(stream: MediaStream | null): void {
  // getTracks is missing on the test DOM's MediaStream stub, and a stream can
  // legitimately be half-torn-down; neither should throw during cleanup.
  try {
    stream?.getTracks?.().forEach((t) => t.stop());
  } catch {
    /* already gone */
  }
}

export type UseCameraStream = {
  status: CameraStatus;
  stream: MediaStream | null;
  error: CameraErrorCode | null;
  torchSupported: boolean;
  torchOn: boolean;
  start: () => void;
  stop: () => void;
  toggleTorch: () => void;
};

export function useCameraStream(): UseCameraStream {
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<CameraErrorCode | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Tracked in a ref as well as state: cleanup runs with the ref's current
  // value, whereas a stale closure over state would stop the wrong stream.
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);

  const stop = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    startingRef.current = false;
    if (mountedRef.current) {
      setStream(null);
      setTorchOn(false);
      setTorchSupported(false);
      setStatus("idle");
    }
  }, []);

  const start = useCallback(() => {
    if (startingRef.current || streamRef.current) return;
    if (!isCameraSupported()) {
      setStatus("unavailable");
      setError("camera_unsupported");
      return;
    }
    startingRef.current = true;
    setStatus("starting");
    setError(null);

    void (async () => {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          // `ideal`, not `exact`: a laptop with only a front camera should
          // still work rather than throwing OverconstrainedError, and the
          // browser clamps to whatever the hardware actually has.
          //
          // 2560 rather than 3840: the capture is capped at
          // MAX_CAPTURE_DIMENSION (2048) on the long edge, so 4K buys no
          // legibility — it only makes every frame the capture path reads back
          // 2.2x larger, which is what pushed iOS past its canvas budget and
          // made the shutter fire into nothing.
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        });

        // The await above is an unbounded gap: StrictMode's double-mount, or a
        // client who tapped away, can unmount us mid-prompt. Adopting the
        // stream now would orphan it with no component left to stop it.
        if (!mountedRef.current) {
          stopStream(media);
          return;
        }

        streamRef.current = media;
        setStream(media);
        setStatus("ready");

        const track = media.getVideoTracks?.()[0];
        const caps = track?.getCapabilities?.() as
          | { torch?: boolean }
          | undefined;
        // Torch is Android-Chrome-only in practice; iOS Safari reports nothing
        // here, so the button simply never appears there.
        setTorchSupported(Boolean(caps?.torch));
      } catch (err) {
        if (!mountedRef.current) return;
        const code = classifyCameraError(err);
        setError(code);
        setStatus(code === "camera_denied" ? "denied" : "error");
      } finally {
        startingRef.current = false;
      }
    })();
  }, []);

  const toggleTorch = useCallback(() => {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    const next = !torchOn;
    void track
      .applyConstraints({
        // `torch` is outside the standard MediaTrackConstraintSet typing but
        // is the real, shipped Chrome API.
        advanced: [{ torch: next } as unknown as MediaTrackConstraintSet],
      })
      .then(() => {
        if (mountedRef.current) setTorchOn(next);
      })
      .catch(() => {
        // Some devices advertise torch and then refuse it. Hide the control
        // rather than leaving a button that does nothing.
        if (mountedRef.current) setTorchSupported(false);
      });
  }, [torchOn]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  return {
    status,
    stream,
    error,
    torchSupported,
    torchOn,
    start,
    stop,
    toggleTorch,
  };
}

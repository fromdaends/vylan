import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import {
  useCameraStream,
  classifyCameraError,
  isCameraSupported,
} from "./use-camera-stream";

// A MediaStream stand-in: the test DOM's real one has no getTracks(), which is
// exactly the shape that used to make teardown throw.
function fakeStream() {
  const stop = vi.fn();
  const track = {
    stop,
    getCapabilities: () => ({ torch: false }),
    applyConstraints: () => Promise.resolve(),
  };
  return {
    stream: {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream,
    stop,
  };
}

function stubMediaDevices(
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>,
) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value: { getUserMedia },
  });
}

function removeMediaDevices() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

afterEach(() => {
  cleanup();
  removeMediaDevices();
  vi.unstubAllGlobals();
});

describe("isCameraSupported", () => {
  it("is false when the browser exposes no mediaDevices (http:// over a LAN IP)", () => {
    removeMediaDevices();
    expect(isCameraSupported()).toBe(false);
  });

  it("is true once getUserMedia exists", () => {
    stubMediaDevices(() => Promise.resolve(fakeStream().stream));
    expect(isCameraSupported()).toBe(true);
  });
});

describe("classifyCameraError", () => {
  it("maps each browser error name to the code we have copy for", () => {
    const cases: [string, string][] = [
      ["NotAllowedError", "camera_denied"],
      ["PermissionDeniedError", "camera_denied"],
      ["SecurityError", "camera_unsupported"],
      ["NotFoundError", "camera_not_found"],
      ["DevicesNotFoundError", "camera_not_found"],
      ["OverconstrainedError", "camera_not_found"],
      ["NotReadableError", "camera_busy"],
      ["TrackStartError", "camera_busy"],
    ];
    for (const [name, code] of cases) {
      expect(classifyCameraError({ name })).toBe(code);
    }
  });

  it("falls back to a generic failure for anything unrecognised", () => {
    expect(classifyCameraError(new Error("boom"))).toBe("camera_failed");
    expect(classifyCameraError(null)).toBe("camera_failed");
    expect(classifyCameraError(undefined)).toBe("camera_failed");
    expect(classifyCameraError("a string")).toBe("camera_failed");
  });
});

describe("useCameraStream", () => {
  it("reports unavailable without ever calling getUserMedia when unsupported", () => {
    removeMediaDevices();
    const { result } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    expect(result.current.status).toBe("unavailable");
    expect(result.current.error).toBe("camera_unsupported");
  });

  it("acquires a stream and becomes ready", async () => {
    const { stream } = fakeStream();
    stubMediaDevices(() => Promise.resolve(stream));
    const { result } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.stream).toBe(stream);
    expect(result.current.error).toBeNull();
  });

  it("asks for the rear camera", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn<(c: MediaStreamConstraints) => Promise<MediaStream>>(
      () => Promise.resolve(stream),
    );
    stubMediaDevices(getUserMedia);
    const { result } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const constraints = getUserMedia.mock.calls[0]![0];
    expect(constraints.audio).toBe(false);
    const video = constraints.video as MediaTrackConstraints;
    expect(video.facingMode).toEqual({ ideal: "environment" });
    // Deliberately NOT 4K. The capture path reads the frame back out of a
    // canvas, and asking for more pixels than the 2048px output can use is
    // what pushed iOS past its canvas budget — the shutter fired into nothing.
    expect((video.width as { ideal: number }).ideal).toBeLessThanOrEqual(2560);
  });

  it("surfaces a denial as denied + camera_denied", async () => {
    stubMediaDevices(() => Promise.reject({ name: "NotAllowedError" }));
    const { result } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(result.current.error).toBe("camera_denied");
    expect(result.current.stream).toBeNull();
  });

  it("surfaces a camera already in use as busy", async () => {
    stubMediaDevices(() => Promise.reject({ name: "NotReadableError" }));
    const { result } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.error).toBe("camera_busy"));
    expect(result.current.status).toBe("error");
  });

  it("ignores a second start() while one is already in flight", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    stubMediaDevices(getUserMedia);
    const { result } = renderHook(() => useCameraStream());
    act(() => {
      result.current.start();
      result.current.start();
      result.current.start();
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("stops every track on stop()", async () => {
    const { stream, stop } = fakeStream();
    stubMediaDevices(() => Promise.resolve(stream));
    const { result } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    act(() => result.current.stop());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.stream).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("releases the camera on unmount — the light must not stay on", async () => {
    const { stream, stop } = fakeStream();
    stubMediaDevices(() => Promise.resolve(stream));
    const { result, unmount } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("releases a stream that arrives AFTER unmount", async () => {
    // StrictMode's double-mount, or a client tapping away while the permission
    // prompt is up: getUserMedia resolves with nobody left to own the stream.
    const { stream, stop } = fakeStream();
    let resolveIt: (s: MediaStream) => void = () => undefined;
    stubMediaDevices(
      () =>
        new Promise<MediaStream>((r) => {
          resolveIt = r;
        }),
    );
    const { result, unmount } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    unmount();
    await act(async () => {
      resolveIt(stream);
      await Promise.resolve();
    });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not throw tearing down a stream with no getTracks", async () => {
    // The test DOM's own MediaStream behaves exactly like this.
    const bare = {} as MediaStream;
    stubMediaDevices(() => Promise.resolve(bare));
    const { result, unmount } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(() => unmount()).not.toThrow();
  });

  it("advertises torch only when the track reports it", async () => {
    const stop = vi.fn();
    const track = {
      stop,
      getCapabilities: () => ({ torch: true }),
      applyConstraints: () => Promise.resolve(),
    };
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    stubMediaDevices(() => Promise.resolve(stream));
    const { result } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.torchSupported).toBe(true));
    await act(async () => {
      result.current.toggleTorch();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.torchOn).toBe(true));
  });

  it("hides the torch control when the device advertises it then refuses", async () => {
    const track = {
      stop: vi.fn(),
      getCapabilities: () => ({ torch: true }),
      applyConstraints: () => Promise.reject(new Error("nope")),
    };
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    stubMediaDevices(() => Promise.resolve(stream));
    const { result } = renderHook(() => useCameraStream());
    act(() => result.current.start());
    await waitFor(() => expect(result.current.torchSupported).toBe(true));
    await act(async () => {
      result.current.toggleTorch();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.torchSupported).toBe(false));
    expect(result.current.torchOn).toBe(false);
  });
});

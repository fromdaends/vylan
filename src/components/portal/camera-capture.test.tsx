import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { CameraCapture, apertureFor } from "./camera-capture";
import en from "../../../messages/en.json";
import {
  __setScanEngineStatusForTests,
  __resetScanEngineForTests,
} from "@/lib/portal/opencv-loader";

// Never let the real 13 MB OpenCV package into a unit test — and, more to the
// point, the status is what this file needs to drive.
vi.mock("@techstark/opencv-js", () => ({ default: {} }));
vi.mock("jscanify/client", () => ({ default: class {} }));

// The analysis loop is inert here on purpose: happy-dom's canvas.getContext()
// returns null, so every pixel path short-circuits. That is exactly why the
// maths lives in pure modules with their own tests — what is worth asserting
// in the component is control flow, permissions and teardown.

function fakeTrack() {
  return {
    stop: vi.fn(),
    getCapabilities: () => ({}),
    applyConstraints: () => Promise.resolve(),
  };
}

function stubCamera(
  impl?: (c: MediaStreamConstraints) => Promise<MediaStream>,
) {
  const track = fakeTrack();
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value: { getUserMedia: impl ?? (() => Promise.resolve(stream)) },
  });
  return { track, stream };
}

function removeCamera() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

function renderCamera() {
  const onClose = vi.fn();
  const onCapture = vi.fn();
  const onChooseFile = vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CameraCapture
        onClose={onClose}
        onCapture={onCapture}
        onChooseFile={onChooseFile}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onClose, onCapture, onChooseFile };
}

afterEach(() => {
  cleanup();
  removeCamera();
  __resetScanEngineForTests();
  vi.unstubAllGlobals();
});

describe("CameraCapture", () => {
  it("shows the camera immediately while the scan engine is still downloading — nobody waits on 13 MB of WASM to see a viewfinder", async () => {
    stubCamera();
    renderCamera();
    __setScanEngineStatusForTests("loading");
    // The shutter is live and the preview is up; the pill only says the
    // detection is about to get better.
    await waitFor(() =>
      expect(screen.getByText(en.Portal.scan_preparing)).toBeTruthy(),
    );
    expect(screen.getByLabelText(en.Portal.scan_capture)).toBeTruthy();
  });

  it("takes the preparing pill down once the engine is ready", async () => {
    stubCamera();
    renderCamera();
    __setScanEngineStatusForTests("loading");
    await waitFor(() =>
      expect(screen.getByText(en.Portal.scan_preparing)).toBeTruthy(),
    );
    __setScanEngineStatusForTests("ready");
    await waitFor(() =>
      expect(screen.queryByText(en.Portal.scan_preparing)).toBeNull(),
    );
  });

  it("says nothing at all when the engine failed — the built-in detector is still running and there is nothing to announce", async () => {
    stubCamera();
    renderCamera();
    __setScanEngineStatusForTests("failed");
    await waitFor(() =>
      expect(screen.getByLabelText(en.Portal.scan_capture)).toBeTruthy(),
    );
    expect(screen.queryByText(en.Portal.scan_preparing)).toBeNull();
  });

  it("renders through a portal on <body>, not inside the checklist row", async () => {
    stubCamera();
    const { container } = renderCamera();
    // Same trap the lightbox documents: the row's entrance animation leaves a
    // transform behind, which would make it a containing block and trap a
    // `fixed` overlay inside it.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("locks background scroll while open and restores it on close", async () => {
    stubCamera();
    const { unmount } = renderCamera();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("closes on Escape", async () => {
    stubCamera();
    const { onClose } = renderCamera();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from the close button", async () => {
    stubCamera();
    const { onClose } = renderCamera();
    fireEvent.click(screen.getByLabelText(en.Portal.scan_close));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("releases the camera when it unmounts — the light must not stay on", async () => {
    const { track } = stubCamera();
    const { unmount } = renderCamera();
    await waitFor(() =>
      expect(screen.getByLabelText(en.Portal.scan_capture)).toBeTruthy(),
    );
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  it("keeps the shutter disabled until the stream is actually live", async () => {
    let resolveIt: (s: MediaStream) => void = () => undefined;
    stubCamera(
      () =>
        new Promise<MediaStream>((r) => {
          resolveIt = r;
        }),
    );
    renderCamera();
    const shutter = screen.getByLabelText(
      en.Portal.scan_capture,
    ) as HTMLButtonElement;
    expect(shutter.disabled).toBe(true);

    const track = fakeTrack();
    resolveIt({
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream);
    await waitFor(() => expect(shutter.disabled).toBe(false));
  });

  describe("when the camera cannot be used", () => {
    it("explains a denial and never dead-ends", async () => {
      stubCamera(() => Promise.reject({ name: "NotAllowedError" }));
      const { onChooseFile, onClose } = renderCamera();

      await waitFor(() =>
        expect(screen.getByText(en.Portal.errors.camera_denied)).toBeTruthy(),
      );
      // A denial is the one case where we also explain how to undo it.
      expect(screen.getByText(en.Portal.scan_denied_help)).toBeTruthy();

      // Exactly one way back to the ordinary picker — offered twice reads as
      // two different options. It must hand off AND close.
      const escape = screen.getByText(en.Portal.scan_choose_file);
      fireEvent.click(escape);
      expect(onChooseFile).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("distinguishes a camera that is missing from one that is busy", async () => {
      stubCamera(() => Promise.reject({ name: "NotFoundError" }));
      renderCamera();
      await waitFor(() =>
        expect(
          screen.getByText(en.Portal.errors.camera_not_found),
        ).toBeTruthy(),
      );
      cleanup();

      stubCamera(() => Promise.reject({ name: "NotReadableError" }));
      renderCamera();
      await waitFor(() =>
        expect(screen.getByText(en.Portal.errors.camera_busy)).toBeTruthy(),
      );
    });

    it("reports a Permissions-Policy block as unsupported, not as a denial", async () => {
      // If the /r/* header rule ever regresses, getUserMedia throws
      // SecurityError with no prompt shown — telling the client they denied
      // something they were never asked would be a lie.
      stubCamera(() => Promise.reject({ name: "SecurityError" }));
      renderCamera();
      await waitFor(() =>
        expect(
          screen.getByText(en.Portal.errors.camera_unsupported),
        ).toBeTruthy(),
      );
      expect(screen.queryByText(en.Portal.scan_denied_help)).toBeNull();
    });

    it("hides the live guidance when there is no stream to guide", async () => {
      stubCamera(() => Promise.reject({ name: "NotAllowedError" }));
      renderCamera();
      await waitFor(() =>
        expect(screen.getByText(en.Portal.errors.camera_denied)).toBeTruthy(),
      );
      expect(screen.queryByText(en.Portal.scan_hint_searching)).toBeNull();
    });
  });
});

describe("apertureFor — the framing window", () => {
  const phone = { width: 375, height: 708 };

  it("sits inside the viewport with room on every side", () => {
    const a = apertureFor(phone);
    expect(a.x).toBeGreaterThan(0);
    expect(a.y).toBeGreaterThan(0);
    expect(a.x + a.width).toBeLessThan(phone.width);
    expect(a.y + a.height).toBeLessThan(phone.height);
  });

  it("leaves clear space below for the coaching line", () => {
    // The hint is anchored near the bottom of the stage; the window must not
    // run into it at any viewport.
    for (const view of [phone, { width: 320, height: 560 }, { width: 430, height: 932 }]) {
      const a = apertureFor(view);
      expect(view.height - (a.y + a.height)).toBeGreaterThanOrEqual(60);
    }
  });

  it("is tall, not near-square", () => {
    // A squat window on a tall phone screen reads as "hold it further away".
    const a = apertureFor(phone);
    expect(a.height / a.width).toBeGreaterThan(1.3);
  });

  it("asks for a share of the frame the detector can actually see", () => {
    // THE load-bearing property, and it is measured, not taste. The detector
    // finds the page 100% of the time while a TILTED page still fits inside
    // the camera frame, and 0% once a corner crosses the edge — it cannot
    // locate a corner that is not in the picture. Measured hit rate by the
    // page's share of the frame:
    //
    //     share   0deg   6deg   14deg   25deg
    //     0.25    100%   100%    100%    100%
    //     0.35    100%   100%    100%     78%
    //     0.45    100%   100%     19%      0%
    //     0.65    100%     0%      0%      0%
    //
    // A window at two thirds of the screen instructs the client straight into
    // the dead zone. Swept finer, 0.42 still holds 100% through 16 degrees and
    // 0.46 is already on the cliff edge — so 0.44 is the ceiling here.
    for (const view of [phone, { width: 393, height: 760 }, { width: 430, height: 932 }]) {
      const a = apertureFor(view);
      const share = (a.width * a.height) / (view.width * view.height);
      expect(share).toBeLessThanOrEqual(0.44);
      // ...and not so small that it reads as a stamp.
      expect(share).toBeGreaterThan(0.22);
    }
  });

  it("leaves real margin on both sides for a tilted page", () => {
    // The margin IS the feature: it is the room a rotated corner needs.
    const a = apertureFor(phone);
    expect(a.x).toBeGreaterThan(phone.width * 0.1);
    expect(a.x + a.width).toBeLessThan(phone.width * 0.9);
  });

  it("stays centred horizontally", () => {
    // Margins equal to within a pixel — an odd leftover cannot be split evenly.
    const a = apertureFor(phone);
    const left = a.x;
    const right = phone.width - (a.x + a.width);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it("is portrait, matching the slips this collects", () => {
    const a = apertureFor(phone);
    expect(a.height).toBeGreaterThan(a.width);
  });

  it("still fits on a short screen", () => {
    // Landscape, or a small phone in a browser with chrome eating the viewport.
    const squat = apertureFor({ width: 800, height: 360 });
    expect(squat.y).toBeGreaterThanOrEqual(0);
    expect(squat.y + squat.height).toBeLessThanOrEqual(360 - 60);
  });

  it("stays valid at degenerate sizes rather than producing negatives", () => {
    for (const view of [
      { width: 0, height: 0 },
      { width: 1, height: 1 },
      { width: 320, height: 0 },
    ]) {
      const a = apertureFor(view);
      expect(a.width).toBeGreaterThanOrEqual(1);
      expect(a.height).toBeGreaterThanOrEqual(1);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(a.x + a.y + a.width + a.height)).toBe(false);
    }
  });

  it("scales with the viewport", () => {
    const small = apertureFor({ width: 320, height: 600 });
    const large = apertureFor({ width: 430, height: 900 });
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
  });
});

describe("apertureFor — clearing the top controls", () => {
  // A notched iPhone: safe-area inset plus the 16px offset and the 44px button
  // put the bottom of the close/torch controls ~110px down the stage.
  const notched = { width: 393, height: 760 };
  const CONTROLS = 110;

  it("starts below the controls instead of underneath them", () => {
    const a = apertureFor(notched, { top: CONTROLS });
    expect(a.y).toBeGreaterThanOrEqual(CONTROLS);
  });

  it("keeps a visible gap, not just a touching edge", () => {
    const a = apertureFor(notched, { top: CONTROLS });
    expect(a.y - CONTROLS).toBeGreaterThanOrEqual(8);
  });

  it("still leaves room for the coaching line once the top is reserved", () => {
    const a = apertureFor(notched, { top: CONTROLS });
    expect(notched.height - (a.y + a.height)).toBeGreaterThanOrEqual(60);
  });

  it("shrinks the window rather than overflowing when both ends are reserved", () => {
    const a = apertureFor(notched, { top: CONTROLS });
    expect(a.y + a.height).toBeLessThanOrEqual(notched.height);
    expect(a.height).toBeGreaterThan(0);
  });

  it("survives an absurd inset without producing a negative window", () => {
    const a = apertureFor(notched, { top: 10_000 });
    expect(a.height).toBeGreaterThanOrEqual(1);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(a.y + a.height)).toBe(false);
  });

  it("ignores a non-finite inset rather than producing NaN geometry", () => {
    for (const top of [NaN, Infinity, -50]) {
      const a = apertureFor(notched, { top });
      expect(Number.isNaN(a.x + a.y + a.width + a.height)).toBe(false);
      expect(a.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("behaves as before when nothing is reserved", () => {
    expect(apertureFor(notched)).toEqual(apertureFor(notched, { top: 0 }));
  });

  // The camera now runs full-bleed with the shutter floating over it, so the
  // bottom is the same trap the top already sprang once: without a measured
  // reserve, the guide window renders UNDERNEATH the shutter button.
  describe("with the floating shutter reserving the bottom", () => {
    // A 76px shutter above a 34px home-indicator inset, plus its own padding.
    const SHUTTER = 134;

    it("keeps the window clear of the shutter", () => {
      const a = apertureFor(notched, { top: CONTROLS, bottom: SHUTTER });
      expect(a.y + a.height).toBeLessThanOrEqual(notched.height - SHUTTER);
    });

    it("still clears the top controls at the same time", () => {
      const a = apertureFor(notched, { top: CONTROLS, bottom: SHUTTER });
      expect(a.y).toBeGreaterThanOrEqual(CONTROLS);
    });

    it("shrinks the window rather than overflowing when both ends are reserved", () => {
      const a = apertureFor(notched, { top: CONTROLS, bottom: SHUTTER });
      expect(a.height).toBeGreaterThan(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y + a.height).toBeLessThanOrEqual(notched.height);
    });

    it("never reserves less than the coaching line needs", () => {
      // A tiny reported inset must not claw back the hint's room.
      const a = apertureFor(notched, { top: CONTROLS, bottom: 1 });
      expect(notched.height - (a.y + a.height)).toBeGreaterThanOrEqual(60);
    });

    it("survives an absurd shutter inset without producing a negative window", () => {
      const a = apertureFor(notched, { top: CONTROLS, bottom: 10_000 });
      expect(a.height).toBeGreaterThanOrEqual(1);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(a.y + a.height)).toBe(false);
    });

    it("ignores a non-finite shutter inset rather than producing NaN geometry", () => {
      for (const bottom of [NaN, Infinity, -50]) {
        const a = apertureFor(notched, { top: CONTROLS, bottom });
        expect(Number.isNaN(a.x + a.y + a.width + a.height)).toBe(false);
        expect(a.height).toBeGreaterThanOrEqual(1);
      }
    });

    it("is unchanged from before when the shutter reports nothing", () => {
      expect(apertureFor(notched, { top: CONTROLS, bottom: 0 })).toEqual(
        apertureFor(notched, { top: CONTROLS }),
      );
    });
  });
});

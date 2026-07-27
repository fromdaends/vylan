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
  vi.unstubAllGlobals();
});

describe("CameraCapture", () => {
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

  it("is tall, not near-square — a page must fit without backing the phone off", () => {
    // The founder's actual complaint: a window at letter proportions off the
    // WIDTH is squat on a tall phone screen, so the document only fits if you
    // hold the camera far enough away that the text goes small.
    const a = apertureFor(phone);
    expect(a.height / a.width).toBeGreaterThan(1.5);
    expect(a.height).toBeGreaterThan(phone.height * 0.6);
  });

  it("uses most of the width", () => {
    const a = apertureFor(phone);
    expect(a.width).toBeGreaterThan(phone.width * 0.85);
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

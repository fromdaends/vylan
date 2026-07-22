import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PortalSplit } from "./portal-split";

// A controllable matchMedia: the desktop pane keys off "(min-width: 1024px)".
function stubMatchMedia(isDesktop: boolean) {
  const impl = (query: string) => ({
    matches: query.includes("min-width: 1024px") ? isDesktop : !isDesktop,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
  vi.stubGlobal("matchMedia", impl);
  // Some test DOMs read window.matchMedia rather than the global.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: impl,
  });
}

function renderSplit(
  overrides: Partial<Parameters<typeof PortalSplit>[0]> = {},
) {
  return render(
    <PortalSplit
      enabled
      messagesOpen={false}
      panel={<div>PANEL</div>}
      {...overrides}
    >
      <div>DOCS</div>
    </PortalSplit>,
  );
}

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PortalSplit", () => {
  it("shows only the documents column (no divider) when messaging is off", () => {
    renderSplit({ enabled: false });
    expect(screen.getByText("DOCS")).toBeInTheDocument();
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    // The thread is never mounted when there's no messaging.
    expect(screen.queryByText("PANEL")).not.toBeInTheDocument();
  });

  it("mounts the docked thread on desktop with a resizable divider", () => {
    stubMatchMedia(true);
    renderSplit();
    expect(screen.getByText("DOCS")).toBeInTheDocument();
    expect(screen.getByText("PANEL")).toBeInTheDocument();
    const handle = screen.getByRole("separator");
    expect(handle).toHaveAttribute("aria-valuenow", "30");
    expect(handle).toHaveAttribute("aria-valuemin", "24");
    expect(handle).toHaveAttribute("aria-valuemax", "48");
  });

  it("keeps the thread unmounted on mobile until it is opened", () => {
    stubMatchMedia(false);
    renderSplit({ messagesOpen: false });
    expect(screen.queryByText("PANEL")).not.toBeInTheDocument();

    cleanup();
    stubMatchMedia(false);
    renderSplit({ messagesOpen: true });
    expect(screen.getByText("PANEL")).toBeInTheDocument();
  });

  it("resizes with the keyboard and clamps to the band", () => {
    stubMatchMedia(true);
    renderSplit();
    const handle = screen.getByRole("separator");

    // Pane is on the right: Left widens it, Right narrows it.
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "33");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "30");

    // Home/End jump to the clamp band and don't overshoot.
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle).toHaveAttribute("aria-valuenow", "48");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "48");

    fireEvent.keyDown(handle, { key: "End" });
    expect(handle).toHaveAttribute("aria-valuenow", "24");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "24");
  });

  it("restores a saved width from localStorage, clamped", () => {
    localStorage.setItem("vylan:portal:messages-width", "42");
    stubMatchMedia(true);
    renderSplit();
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );

    cleanup();
    // Out-of-band saved values are pulled back into the band.
    localStorage.setItem("vylan:portal:messages-width", "99");
    stubMatchMedia(true);
    renderSplit();
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-valuenow",
      "48",
    );
  });
});

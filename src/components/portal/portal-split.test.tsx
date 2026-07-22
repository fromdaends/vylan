import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
  stubMatchMedia(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PortalSplit", () => {
  it("shows only the documents column when messaging is off", () => {
    renderSplit({ enabled: false });
    expect(screen.getByText("DOCS")).toBeInTheDocument();
    // The thread is never mounted when there's no messaging.
    expect(screen.queryByText("PANEL")).not.toBeInTheDocument();
  });

  it("mounts the docked thread on desktop as a fixed pane (no divider)", () => {
    stubMatchMedia(true);
    renderSplit();
    expect(screen.getByText("DOCS")).toBeInTheDocument();
    expect(screen.getByText("PANEL")).toBeInTheDocument();
    // The pane is a fixed width now — no resize handle.
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
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
});

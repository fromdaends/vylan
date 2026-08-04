import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

// The bar reads the URL to know a navigation finished, so the test drives the
// router hooks directly rather than pretending to be Next.
let pathname = "/dashboard";
let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

import { RouteProgress } from "./route-progress";

/** The bar's outer element, or null when it is not showing. */
const bar = () =>
  document.querySelector<HTMLElement>('div[aria-hidden][class*="fixed"]');
const inner = () => bar()?.firstElementChild as HTMLElement | null;

function clickLink(href: string, attrs: Record<string, string> = {}) {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  document.body.appendChild(a);
  act(() => {
    a.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
  });
  a.remove();
}

/**
 * A navigation completing — the URL is what tells the bar it is over.
 *
 * RE-RENDERS the mounted tree rather than mounting a fresh one. A remount would
 * initialise the component's "last seen URL" to the new value, so it would see
 * no CHANGE and never finish — which is the test measuring its own setup
 * instead of the component.
 */
function arriveAt(next: string, rerender: (ui: React.ReactElement) => void) {
  const [p, s = ""] = next.split("?");
  pathname = p;
  search = s;
  act(() => rerender(<RouteProgress />));
}

beforeEach(() => {
  vi.useFakeTimers();
  pathname = "/dashboard";
  search = "";
  window.history.replaceState({}, "", "/dashboard");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RouteProgress", () => {
  it("shows nothing at rest — a bar on an idle page is noise", () => {
    render(<RouteProgress />);
    expect(bar()).toBeNull();
  });

  it("appears the moment an in-app link is clicked", () => {
    render(<RouteProgress />);
    clickLink("/clients");
    expect(bar()).not.toBeNull();
    // The creep, not a jump: it starts from nothing and eases toward 90%.
    expect(inner()?.className).toContain("animate-[route-progress");
  });

  it("holds at 90% rather than claiming a percentage it cannot know", () => {
    render(<RouteProgress />);
    clickLink("/clients");
    expect(inner()?.className).toContain("w-[90%]");
    expect(inner()?.className).not.toContain("w-full");
  });

  // Every one of these would leave a bar creeping over a page that is not
  // going anywhere.
  it.each([
    ["an anchor on the same page", "#section", {}],
    ["a link to another site", "https://example.com/x", {}],
    ["a download", "/export.zip", { download: "" }],
    ["a new tab", "/clients", { target: "_blank" }],
    ["the page you are already on", "/dashboard", {}],
  ])("ignores %s", (_label, href, attrs) => {
    render(<RouteProgress />);
    clickLink(href, attrs as Record<string, string>);
    expect(bar()).toBeNull();
  });

  it("finishes when the new page arrives, then takes itself away", () => {
    const { rerender } = render(<RouteProgress />);
    clickLink("/clients");
    expect(bar()).not.toBeNull();

    arriveAt("/clients", rerender);
    // The floor: a prefetched page arrives in a few frames, and the bar must
    // still be visible when it does.
    expect(inner()?.className).toContain("w-[90%]");
    act(() => void vi.advanceTimersByTime(400));
    rerender(<RouteProgress />);
    // NOW it finishes — full width and fading, the snap people read as "done".
    expect(inner()?.className).toContain("w-full");
    expect(inner()?.className).toContain("opacity-0");

    act(() => void vi.advanceTimersByTime(500));
    rerender(<RouteProgress />);
    expect(bar()).toBeNull();
  });

  // /work?due=overdue leaves the pathname alone. Watching only the path would
  // start the bar and never finish it.
  it("treats a query-only navigation as a navigation", () => {
    const { rerender } = render(<RouteProgress />);
    clickLink("/dashboard?due=overdue");
    expect(bar()).not.toBeNull();
    arriveAt("/dashboard?due=overdue", rerender);
    act(() => void vi.advanceTimersByTime(400));
    rerender(<RouteProgress />);
    expect(inner()?.className).toContain("w-full");
  });

  // ⚠️ The one that keeps a bug from becoming permanent furniture. A
  // navigation that never resolves must not leave a bar creeping forever.
  it("gives up after its ceiling rather than creeping for ever", () => {
    const { rerender } = render(<RouteProgress />);
    clickLink("/clients");
    expect(bar()).not.toBeNull();

    act(() => void vi.advanceTimersByTime(20001));
    rerender(<RouteProgress />);
    expect(bar()).toBeNull();
  });

  it("starts on back and forward too, which never go through a link", () => {
    render(<RouteProgress />);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(bar()).not.toBeNull();
  });

  it("is two pixels and never takes a click", () => {
    render(<RouteProgress />);
    clickLink("/clients");
    expect(bar()?.className).toContain("h-0.5");
    expect(bar()?.className).toContain("pointer-events-none");
  });

  // ⚠️ The reason the first version was invisible. Next prefetches every <Link>
  // in view, so most navigations land in under 50ms; a bar that finishes that
  // fast mounts and unmounts inside three frames and reads as nothing
  // happening — the exact complaint it was built to answer.
  it("stays up for its floor even when the page arrives immediately", () => {
    const { rerender } = render(<RouteProgress />);
    clickLink("/clients");

    // The page lands almost at once.
    act(() => void vi.advanceTimersByTime(30));
    arriveAt("/clients", rerender);

    // Still creeping, not finishing.
    expect(inner()?.className).toContain("w-[90%]");
    expect(inner()?.className).not.toContain("opacity-0");

    act(() => void vi.advanceTimersByTime(400));
    rerender(<RouteProgress />);
    expect(inner()?.className).toContain("w-full");
  });

  it("does NOT add the floor on top of a slow page", () => {
    // A page that already took longer than the floor finishes at once —
    // padding a slow navigation would make it feel slower still.
    const { rerender } = render(<RouteProgress />);
    clickLink("/clients");
    act(() => void vi.advanceTimersByTime(1500));
    arriveAt("/clients", rerender);
    expect(inner()?.className).toContain("w-full");
  });
});

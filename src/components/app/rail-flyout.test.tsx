import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
import { ListTodo, FileText } from "lucide-react";

// The panel links through the locale-aware router, which cannot resolve under
// vitest. Only the href matters here, so a plain anchor is a faithful stand-in.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { RailFlyout } from "./rail-flyout";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ITEMS = [
  {
    href: "/work",
    label: "Tasks",
    description: "Everything the firm has to do",
    icon: ListTodo,
  },
  {
    href: "/engagements",
    label: "Engagements",
    description: "Jobs with a client portal",
    icon: FileText,
  },
];

function renderPanel(overrides: Partial<Parameters<typeof RailFlyout>[0]> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <div>
      {/* Stands in for the icon rail. The panel treats it as exempt from
          click-outside so a click on another section switches rather than
          merely dismissing. */}
      <aside data-rail>
        <button type="button">Clients</button>
      </aside>
      <main>
        <button type="button">Something on the page</button>
      </main>
      <RailFlyout
        open
        title="Work"
        items={ITEMS}
        activeHref={null}
        closeLabel="Close"
        autoFocus={false}
        onClose={onClose}
        {...overrides}
      />
    </div>,
  );
  return { ...utils, onClose };
}

describe("RailFlyout", () => {
  it("stays mounted when closed, but out of reach", () => {
    // The whole reason it is not unmounted: a panel that does not exist has no
    // frame to animate FROM, which is why the first version appeared with no
    // transition at all. `inert` is what keeps "still in the DOM" from meaning
    // "still tabbable".
    const { getByRole } = renderPanel({ open: false });
    const panel = getByRole("dialog", { hidden: true });
    expect(panel).toBeTruthy();
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    expect(panel.className).toContain("opacity-0");
    expect(panel.className).toContain("pointer-events-none");
  });

  it("is reachable and fully opaque when open", () => {
    const { getByRole } = renderPanel();
    const panel = getByRole("dialog");
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(panel.getAttribute("aria-hidden")).toBe("false");
    expect(panel.className).toContain("opacity-100");
  });

  it("is anchored to the rail's own width, never a hardcoded pixel count", () => {
    // The founder's "its overlapping with the page" had exactly one cause: the
    // panel was pinned at left:76px while --rail-width is 92px, so it sat
    // sixteen pixels underneath the navigation. Naming the variable is what
    // stops the two drifting again.
    const { getByRole } = renderPanel();
    expect(getByRole("dialog").className).toContain("left-[var(--rail-width)]");
    expect(getByRole("dialog").className).not.toMatch(/left-\[\d+px\]/);
  });

  it("shows a label and its one line for every row", () => {
    const { getByRole } = renderPanel();
    const nav = within(getByRole("dialog"));
    for (const item of ITEMS) {
      const link = nav.getByRole("link", { name: new RegExp(item.label) });
      expect(link.getAttribute("href")).toBe(item.href);
      expect(link.textContent).toContain(item.description);
    }
  });

  it("marks the row you are standing on, for sighted and screen-reader users alike", () => {
    const { getByRole } = renderPanel({ activeHref: "/engagements" });
    const nav = within(getByRole("dialog"));
    expect(
      nav.getByRole("link", { name: /Engagements/ }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      nav.getByRole("link", { name: /Tasks/ }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("closes on Escape, on the close button, and on picking a room", () => {
    const { getByRole, getByLabelText, onClose } = renderPanel();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(within(getByRole("dialog")).getByRole("link", { name: /Tasks/ }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  // The founder, on a blue ring left sitting on the first row after an ordinary
  // click: "get rid of the blue ring". The ring is correct — it is how a
  // keyboard user knows where they are. What was wrong is that it appeared for
  // people who had not used the keyboard, so focus follows the MODALITY now.
  it("takes focus on open only when it was opened from the keyboard", () => {
    const byMouse = renderPanel({ autoFocus: false });
    expect(byMouse.getByRole("dialog").contains(document.activeElement)).toBe(
      false,
    );
    cleanup();

    const byKeyboard = renderPanel({ autoFocus: true });
    expect(
      within(byKeyboard.getByRole("dialog")).getByRole("link", { name: /Tasks/ }),
    ).toBe(document.activeElement);
  });

  it("asks for focus back only when the close was a keyboard one", () => {
    const { getByLabelText, getByText, onClose } = renderPanel();

    // Escape is keyboard by definition.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenLastCalledWith({ restoreFocus: true });

    // detail: 0 is how the DOM reports Enter/Space on a button; a real pointer
    // click carries detail >= 1. Getting this backwards is what left a ring
    // around the rail item after every ordinary click.
    fireEvent.click(getByLabelText("Close"), { detail: 0 });
    expect(onClose).toHaveBeenLastCalledWith({ restoreFocus: true });

    fireEvent.click(getByLabelText("Close"), { detail: 1 });
    expect(onClose).toHaveBeenLastCalledWith({ restoreFocus: false });

    // Clicking out on the page never asks for focus back — there is nothing
    // keyboard about it.
    onClose.mockClear();
    fireEvent.pointerDown(getByText("Something on the page"));
    expect(onClose).toHaveBeenLastCalledWith();
  });

  it("closes on a click out on the page, but NOT on a click on the rail", () => {
    const { getByText, onClose } = renderPanel();

    // The rail is exempt: clicking a different section should SWITCH panels.
    // Without this, the click that opens the next one would be eaten closing
    // this one, and the section would look like it did nothing.
    fireEvent.pointerDown(getByText("Clients"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(getByText("Something on the page"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("listens for nothing at all while closed", () => {
    const { onClose } = renderPanel({ open: false });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("puts focus inside on a keyboard open so the keyboard can carry on", () => {
    const { getByRole } = renderPanel({ autoFocus: true });
    const first = within(getByRole("dialog")).getByRole("link", { name: /Tasks/ });
    expect(document.activeElement).toBe(first);
  });
});

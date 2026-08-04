import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
import { CircleCheckBig, UserPlus } from "lucide-react";

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
  },
  {
    href: "/engagements",
    label: "Engagements",
    description: "Jobs with a client portal",
  },
];

// Canopy's three-up shortcut row, above the list.
const ACTIONS = [
  { href: "/work?new=1", label: "Create task", icon: CircleCheckBig },
  { href: "/clients?new=1", label: "Add client", icon: UserPlus },
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

// ── Canopy's shape ────────────────────────────────────────────────────────
//
// The founder sent Canopy's own Create panel as the reference. Two things
// define its list and both are load-bearing: the label carries the LINK COLOUR
// with the chevron INLINE after the words (not parked at the right edge like a
// settings menu), and there are NO ICONS. The icons were a deliberate earlier
// fix for "the text ui looks bad" — this reverses that on purpose, so these
// tests exist to stop a future session helpfully restoring them.
describe("RailFlyout — the Canopy row", () => {
  it("shows the label and its description, with no icon", () => {
    const { getByRole } = renderPanel();
    const row = getByRole("link", { name: /Tasks/ });
    expect(row).toHaveTextContent("Tasks");
    expect(row).toHaveTextContent("Everything the firm has to do");
    // One chevron, and nothing else drawn. An icon block would be a second.
    expect(row.querySelectorAll("svg")).toHaveLength(1);
  });

  it("keeps the chevron visible rather than revealing it on hover", () => {
    // A chevron that only appears under the cursor is an answer to "is this
    // clickable". Canopy's is part of the sentence, so it is always there.
    const { getByRole } = renderPanel();
    const chevron = getByRole("link", { name: /Tasks/ }).querySelector("svg");
    expect(chevron?.getAttribute("class") ?? "").not.toContain("opacity-0");
  });
});

describe("RailFlyout — the action strip", () => {
  it("renders a round button per action, linking where it says", () => {
    const { getByRole } = renderPanel({ actions: ACTIONS });
    expect(getByRole("link", { name: "Create task" })).toHaveAttribute(
      "href",
      "/work?new=1",
    );
    expect(getByRole("link", { name: "Add client" })).toHaveAttribute(
      "href",
      "/clients?new=1",
    );
  });

  it("closes the panel when an action is taken", () => {
    // Leaving it open behind the page you just navigated to would cover the
    // thing you asked for.
    const { getByRole, onClose } = renderPanel({ actions: ACTIONS });
    fireEvent.click(getByRole("link", { name: "Add client" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("draws no strip at all when a panel has no actions", () => {
    // The section panels (Work) are a plain list — an empty strip would leave a
    // rule and a gap above the first row.
    const { queryByRole } = renderPanel();
    expect(queryByRole("link", { name: "Create task" })).toBeNull();
    expect(queryByRole("link", { name: "Add client" })).toBeNull();
  });
});

describe("RailFlyout — a panel that is nothing but buttons", () => {
  // Work's shape after the founder asked for "the same with the two blue
  // icons": its two destinations ARE the strip, so there are no rows at all.
  it("draws no rule under the strip when there are no rows", () => {
    const { container } = renderPanel({ actions: ACTIONS, items: [] });
    // A panel ending on a rule with empty space under it reads as a list that
    // failed to load.
    expect(container.querySelectorAll(".h-px")).toHaveLength(0);
  });

  it("keeps the rule when rows follow the strip", () => {
    const { container } = renderPanel({ actions: ACTIONS });
    expect(container.querySelectorAll(".h-px")).toHaveLength(1);
  });

  it("marks the button you are already standing on", () => {
    // The panel's whole job is saying which room you are in. Moving Work's
    // destinations from rows to buttons must not lose that.
    const { getByRole } = renderPanel({
      actions: [
        { href: "/work", label: "Tasks", icon: CircleCheckBig },
        { href: "/engagements", label: "Engagements", icon: UserPlus },
      ],
      items: [],
      activeHref: "/work",
    });
    expect(getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(getByRole("link", { name: "Engagements" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("marks nothing when the buttons are create-links rather than places", () => {
    // The Create panel's buttons are ?new=1 links. Nobody is ever "on" one.
    const { getByRole } = renderPanel({ actions: ACTIONS, activeHref: null });
    expect(getByRole("link", { name: "Create task" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

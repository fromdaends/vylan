import { describe, it, expect, afterEach, vi } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import { useState } from "react";
import { TemplateBuilderShell, type BuilderTab } from "./template-builder-shell";

// The wizard's behaviour, tested rather than clicked.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// Every rule below is invisible in the markup and only shows up in a sequence:
// a checkmark that appears when you LEAVE a step and hides again when you walk
// back past it, a Back button that exists in a five-step flow and must not
// exist in a one-step one, a Next that turns into the save on the last step.
// A screenshot cannot catch any of them, and the browser preview this repo
// uses cannot be driven when its pane is closed — which is exactly when these
// would regress unnoticed.
//
// The checkmark rule is the one worth guarding hardest. The obvious
// implementation — "done once, ticked forever" — passes a casual look and is
// wrong: it draws a column of ticks with your position buried in the middle of
// it, which is the question the steps box exists to answer.

afterEach(cleanup);

const TABS: BuilderTab[] = [
  { key: "one", label: "Basics", description: "Name it" },
  { key: "two", label: "Introduction", description: "Greet them" },
  { key: "three", label: "Services", description: "Price it" },
];

function Harness({
  tabs = TABS,
  onFinal = vi.fn(),
  onClose = vi.fn(),
}: {
  tabs?: BuilderTab[];
  onFinal?: () => void;
  onClose?: () => void;
}) {
  // The builder owns the step, exactly as the real ones do — the shell derives
  // done / maxVisited / direction from watching it, and that derivation is
  // what these tests are actually about.
  const [step, setStep] = useState(tabs[0].key);
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <TemplateBuilderShell
        kicker="Engagement template"
        title="Create engagement template"
        explainer="A reusable shape."
        tabs={tabs}
        activeTab={step}
        onTabChange={setStep}
        finalAction={{ label: "Save template", onClick: onFinal }}
        onClose={onClose}
      >
        <p>step body</p>
      </TemplateBuilderShell>
    </NextIntlClientProvider>
  );
}

/**
 * The step buttons in the steps box, in order.
 *
 * Selected STRUCTURALLY, not by their text. Picking them out by a leading
 * digit — the obvious first attempt — silently drops any step that has turned
 * into a checkmark, because a ticked step no longer renders its number. The
 * array then shifts by one and every assertion below quietly reads the wrong
 * step.
 */
function stepButtons() {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("ol li > button"),
  );
}

/** Does the step at `index` currently draw a checkmark rather than a number? */
function isChecked(index: number) {
  const b = stepButtons()[index];
  return b.querySelector("svg") !== null;
}

describe("the guided wizard", () => {
  it("marks the step you LEAVE as done, and only behind the cursor", () => {
    render(<Harness />);

    // Nothing is done on arrival — including step 1, which you are standing on.
    expect(isChecked(0)).toBe(false);
    expect(isChecked(1)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // The step you left is ticked. The one you are on is not.
    expect(isChecked(0)).toBe(true);
    expect(isChecked(1)).toBe(false);
  });

  it("hides the tick again when you walk back past it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(isChecked(0)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    // ⚠️ THE RULE. Progress is REMEMBERED (step 2 is still reachable below) but
    // it is not DRAWN in front of where you are standing.
    expect(isChecked(0)).toBe(false);
  });

  it("re-ticks as you pass a step again", () => {
    render(<Harness />);
    const next = () =>
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    next();
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    next();
    expect(isChecked(0)).toBe(true);
  });

  it("only lets you jump as far as you have already been", () => {
    render(<Harness />);
    // Step 3 is two ahead and must not be reachable yet.
    expect(stepButtons()[2]).toBeDisabled();
    expect(stepButtons()[1]).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(stepButtons()[1]).not.toBeDisabled();
    expect(stepButtons()[2]).toBeDisabled();
  });

  it("turns the last Continue into the flow's real action", () => {
    const onFinal = vi.fn();
    render(<Harness onFinal={onFinal} />);
    const next = () =>
      fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    next();
    next();

    // No Continue left — the founder's rule: the last Next flips into the
    // thing you came to do.
    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /save template/i }));
    expect(onFinal).toHaveBeenCalledOnce();
  });

  it("counts the steps and moves the progress bar", () => {
    render(<Harness />);
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  describe("a single-step flow (client, invoice, import)", () => {
    const ONE: BuilderTab[] = [{ key: "only", label: "Add client" }];

    it("draws no steps box", () => {
      render(<Harness tabs={ONE} />);
      expect(screen.queryByText(/^Step 1 of/)).toBeNull();
    });

    it("draws NO Back button — not a disabled one", () => {
      render(<Harness tabs={ONE} />);
      // A greyed control beside the one thing to do is a step somebody spends
      // a moment looking for.
      expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
    });

    it("puts the flow's action in the footer straight away", () => {
      const onFinal = vi.fn();
      render(<Harness tabs={ONE} onFinal={onFinal} />);
      expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /save template/i }));
      expect(onFinal).toHaveBeenCalledOnce();
    });
  });
});

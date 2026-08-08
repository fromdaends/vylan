import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InfoHint } from "@/components/ui/info-hint";

// The point of this component is that the explanation is REACHABLE — the two
// hand-rolled copies it replaced disagreed about that, and one of them was a
// bare <span> you could only open with a mouse. So the trigger's shape and its
// accessible name are what these assert.
//
// Whether Radix actually pops the panel open is Radix's business and does not
// survive jsdom's synthetic events honestly; that half is verified in a real
// browser instead.

describe("InfoHint", () => {
  it("names itself with the hint when there is no visible label", () => {
    render(<InfoHint text="What this number means" />);
    expect(
      screen.getByRole("button", { name: "What this number means" }),
    ).toBeInTheDocument();
  });

  it("lets a visible label be the name instead, rather than announcing both", () => {
    render(<InfoHint text="The long explanation">Estimated</InfoHint>);
    const trigger = screen.getByRole("button", { name: "Estimated" });
    expect(trigger).not.toHaveAttribute("aria-label");
  });

  it("is a real button — focusable, so a keyboard can reach the hint", () => {
    render(<InfoHint text="Hours logged since January 1" />);
    const trigger = screen.getByRole("button");
    expect(trigger.tagName).toBe("BUTTON");
    trigger.focus();
    expect(trigger).toHaveFocus();
  });

  it("is type=button, so it can never submit a form it sits inside", () => {
    render(
      <form>
        <InfoHint text="x" />
      </form>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("keeps the icon out of the accessible name", () => {
    render(<InfoHint text="Only these words">Estimated</InfoHint>);
    expect(screen.getByRole("button", { name: "Estimated" })).toBeVisible();
  });
});

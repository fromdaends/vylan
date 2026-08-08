import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { HoursInput } from "./hours-input";

afterEach(cleanup);

function mount(valueMinutes: number | null, onChange = vi.fn()) {
  render(
    <HoursInput
      valueMinutes={valueMinutes}
      onChangeMinutes={onChange}
      ariaLabel="Hours"
    />,
  );
  return {
    box: screen.getByLabelText("Hours") as HTMLInputElement,
    onChange,
  };
}

describe("HoursInput — the typing bug it exists to kill", () => {
  // The whole reason this is a component: rendering the stored MINUTES back
  // into the box on every keystroke makes the field unusable. "2.5" has to
  // survive the "2." that exists for one keystroke in the middle of it.
  it("lets you type a decimal all the way through", () => {
    const { box, onChange } = mount(null);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "2" } });
    fireEvent.change(box, { target: { value: "2." } });
    fireEvent.change(box, { target: { value: "2.5" } });
    // The text under the cursor is exactly what was typed — never rewritten.
    expect(box.value).toBe("2.5");
    expect(onChange).toHaveBeenLastCalledWith(150);
  });

  it("reports minutes as you type, so a live total can follow", () => {
    const { box, onChange } = mount(null);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith(120);
  });

  it("tidies the display on blur, and the tidied text round-trips", () => {
    const { box, onChange } = mount(null);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "2.5" } });
    fireEvent.blur(box);
    expect(box.value).toBe("2h 30m");
    // Re-blurring the canonical rendering must not change the value — that is
    // the property that makes formatMinutes safe to use as the display.
    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(onChange).toHaveBeenLastCalledWith(150);
  });
});

describe("HoursInput — what the vocabulary accepts", () => {
  it.each([
    ["2", 120],
    ["2.5", 150],
    ["2,5", 150],
    ["2h30", 150],
    ["90m", 90],
    ["1:30", 90],
  ])("reads %s as %i minutes", (typed, minutes) => {
    const { box, onChange } = mount(null);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: typed } });
    expect(onChange).toHaveBeenLastCalledWith(minutes);
  });

  // "Nobody has timed this" and "this takes no time" are different claims and
  // only one is safe to add into a capacity board's totals.
  //
  // Starts from a FILLED box so the empty case is a real clear — changing an
  // already-empty input to "" fires no event at all, and the assertion would
  // then be passing on a call that never happened.
  it.each([[""], ["0"], ["banana"]])("reports NULL, never 0, for %s", (typed) => {
    const { box, onChange } = mount(120);
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: typed } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("HoursInput — following an outside change", () => {
  it("shows a value that arrives from outside while unfocused", () => {
    // Picking a catalogue service fills the hours in; the box has to show it.
    const onChange = vi.fn();
    const { rerender } = render(
      <HoursInput
        valueMinutes={null}
        onChangeMinutes={onChange}
        ariaLabel="Hours"
      />,
    );
    rerender(
      <HoursInput
        valueMinutes={120}
        onChangeMinutes={onChange}
        ariaLabel="Hours"
      />,
    );
    expect((screen.getByLabelText("Hours") as HTMLInputElement).value).toBe("2h");
  });

  it("does NOT overwrite what you are typing", () => {
    // The loop this component exists to break: an outside value landing
    // mid-keystroke must lose to the cursor.
    const onChange = vi.fn();
    const { rerender } = render(
      <HoursInput
        valueMinutes={null}
        onChangeMinutes={onChange}
        ariaLabel="Hours"
      />,
    );
    const box = screen.getByLabelText("Hours") as HTMLInputElement;
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "3." } });
    rerender(
      <HoursInput
        valueMinutes={120}
        onChangeMinutes={onChange}
        ariaLabel="Hours"
      />,
    );
    expect(box.value).toBe("3.");
  });
});

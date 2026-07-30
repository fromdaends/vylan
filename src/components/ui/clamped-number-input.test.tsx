import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ClampedNumberInput, clampToRange } from "./clamped-number-input";

afterEach(() => cleanup());

// A parent that behaves like the real reminder editors: it owns the number and
// re-renders the input from it, which is what made the old field un-editable.
function Host({
  initial = 1,
  min = 1,
  max = 365,
  onCommit,
}: {
  initial?: number;
  min?: number;
  max?: number;
  onCommit?: (n: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ClampedNumberInput
        value={value}
        min={min}
        max={max}
        aria-label="days"
        onCommit={(n) => {
          setValue(n);
          onCommit?.(n);
        }}
      />
      <output data-testid="committed">{value}</output>
    </>
  );
}

const box = () => screen.getByLabelText("days") as HTMLInputElement;
const committed = () => screen.getByTestId("committed").textContent;

describe("clampToRange", () => {
  it("clamps a real number into range", () => {
    expect(clampToRange("14", 1, 365, 1)).toBe(14);
    expect(clampToRange("0", 1, 365, 1)).toBe(1);
    expect(clampToRange("9999", 1, 365, 1)).toBe(365);
    expect(clampToRange("7.9", 1, 365, 1)).toBe(7);
  });

  // The heart of it: nothing typed yet is NOT "the minimum". Treating it as the
  // minimum is precisely what pinned the old field at 1.
  it("keeps the caller's value for an empty or junk box", () => {
    expect(clampToRange("", 1, 365, 30)).toBe(30);
    expect(clampToRange("   ", 1, 365, 30)).toBe(30);
    expect(clampToRange("abc", 1, 365, 30)).toBe(30);
  });
});

describe("ClampedNumberInput — the founder's exact keystrokes", () => {
  // "I can't erase the 1 and type in another number."
  it("lets you clear the box and type a different number", () => {
    render(<Host initial={1} />);
    fireEvent.change(box(), { target: { value: "" } });
    expect(box().value).toBe(""); // the box actually empties — it used to snap back to "1"
    fireEvent.change(box(), { target: { value: "14" } });
    expect(box().value).toBe("14");
    expect(committed()).toBe("14");
  });

  // The observed symptom: the 1 survived the Backspace, so the next digit
  // landed AFTER it. 1 then "2" gave 12 instead of 2.
  it("does not leave the old digit in front of the new one", () => {
    render(<Host initial={1} />);
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.change(box(), { target: { value: "2" } });
    expect(box().value).toBe("2");
    expect(committed()).toBe("2");
  });

  it("holds the last good value while the box is empty", () => {
    const onCommit = vi.fn();
    render(<Host initial={7} onCommit={onCommit} />);
    fireEvent.change(box(), { target: { value: "" } });
    expect(committed()).toBe("7"); // nothing committed from an empty box
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("settles an empty box back to its value on blur", () => {
    render(<Host initial={7} />);
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.blur(box());
    expect(box().value).toBe("7");
    expect(committed()).toBe("7");
  });

  it("still refuses out-of-range values — the clamp is intact", () => {
    render(<Host initial={1} max={12} />);
    fireEvent.change(box(), { target: { value: "99" } });
    expect(committed()).toBe("12");
    fireEvent.change(box(), { target: { value: "0" } });
    expect(committed()).toBe("1");
  });

  it("lets you type a multi-digit number one key at a time", () => {
    render(<Host initial={1} />);
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.change(box(), { target: { value: "3" } });
    fireEvent.change(box(), { target: { value: "30" } });
    expect(box().value).toBe("30");
    expect(committed()).toBe("30");
  });

  // Switching reminder preset replaces the numbers from outside.
  it("adopts a value changed from outside", () => {
    function Outside() {
      const [v, setV] = useState(1);
      return (
        <>
          <ClampedNumberInput
            value={v}
            min={1}
            max={365}
            aria-label="days"
            onCommit={setV}
          />
          <button onClick={() => setV(14)}>preset</button>
        </>
      );
    }
    render(<Outside />);
    expect(box().value).toBe("1");
    fireEvent.click(screen.getByText("preset"));
    expect(box().value).toBe("14");
  });
});

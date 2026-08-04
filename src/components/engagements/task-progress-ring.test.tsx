import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { TaskProgressRing } from "./task-progress-ring";

afterEach(cleanup);

describe("TaskProgressRing", () => {
  // ⚠️ THE RULE THIS EXISTS FOR. A task nobody has broken down has nothing to
  // measure, and a 0% ring on it reads as "started and got nowhere" — a
  // judgement about work that has not been planned yet. The founder's own call
  // on the engagements list was the same: blank is not zero.
  it("draws nothing at all when the task has no steps", () => {
    const { container } = render(
      <TaskProgressRing done={0} total={0} label="Progress" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("draws an empty ring when there are steps but none are done", () => {
    render(<TaskProgressRing done={0} total={4} label="Progress" />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("rounds to whole percent", () => {
    render(<TaskProgressRing done={1} total={3} label="Progress" />);
    expect(screen.getByText("33%")).toBeInTheDocument();
  });

  it("reaches a full ring at 100, with no gap left in the arc", () => {
    const { container } = render(
      <TaskProgressRing done={3} total={3} label="Progress" />,
    );
    expect(screen.getByText("100%")).toBeInTheDocument();
    // The drawn arc must equal the circumference — an off-by-one in a gauge
    // hides exactly here, as a hairline gap at the top of a finished ring.
    const arc = container.querySelectorAll("circle")[1];
    const [filled, total] = (arc.getAttribute("strokeDasharray") ??
      arc.getAttribute("stroke-dasharray") ??
      "")
      .split(" ")
      .map(Number);
    expect(filled).toBeCloseTo(total, 5);
  });

  it("announces the percentage, since the ring itself is decoration", () => {
    render(<TaskProgressRing done={1} total={2} label="Progress" />);
    expect(screen.getByRole("img", { name: "50% Progress" })).toBeInTheDocument();
  });
});

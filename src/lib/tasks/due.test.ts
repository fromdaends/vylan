import { describe, it, expect } from "vitest";
import { formatDue, isOverdue } from "./due";

// Lifted out of tasks-table.tsx when the engagement page went to cards. Both
// surfaces now ask the same function what "late" means, which is the whole
// reason it moved — two lists disagreeing about whether today counts is the
// kind of thing nobody notices until a client is chased a day early.
describe("formatDue", () => {
  it("reads the parts and never constructs a Date", () => {
    // `new Date("2026-08-05")` is parsed as UTC midnight, which prints as the
    // 4th for anyone west of London. This is why the function is string-only.
    expect(formatDue("2026-08-05")).toBe("05/08/26");
    expect(formatDue("2026-01-01")).toBe("01/01/26");
  });
});

describe("isOverdue", () => {
  const TODAY = "2026-08-05";

  it("is late only STRICTLY before today", () => {
    expect(isOverdue("2026-08-04", "todo", TODAY)).toBe(true);
    expect(isOverdue("2026-08-06", "todo", TODAY)).toBe(false);
  });

  it("does not call today's work late", () => {
    // Colouring due-today red is how a list teaches people to ignore red.
    expect(isOverdue(TODAY, "todo", TODAY)).toBe(false);
  });

  it("stops caring once the task is done", () => {
    // A finished task that was late is history, not something to chase.
    expect(isOverdue("2020-01-01", "done", TODAY)).toBe(false);
  });

  it("is never late without a due date", () => {
    expect(isOverdue(null, "todo", TODAY)).toBe(false);
    expect(isOverdue(undefined, "todo", TODAY)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { buildReminderPlan } from "./reminders";

describe("buildReminderPlan", () => {
  const sentAt = new Date("2026-05-01T12:00:00Z");

  it("schedules gentle + firm + deadline when there is no due date", () => {
    const plan = buildReminderPlan({ sentAt, dueDate: null });
    expect(plan.map((p) => p.tone)).toEqual(["gentle", "firm", "deadline"]);
  });

  it("adds an overdue reminder when due_date is set", () => {
    const plan = buildReminderPlan({ sentAt, dueDate: "2026-05-20" });
    expect(plan.map((p) => p.tone)).toContain("overdue");
  });

  it("schedules each reminder at the right offset in days", () => {
    const plan = buildReminderPlan({ sentAt, dueDate: null });
    const offsets = plan.map(
      (p) => (p.runAfter.getTime() - sentAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(offsets[0]).toBeCloseTo(3, 5);
    expect(offsets[1]).toBeCloseTo(7, 5);
    expect(offsets[2]).toBeCloseTo(14, 5);
  });

  it("turns SMS on for firm + deadline only", () => {
    const plan = buildReminderPlan({ sentAt, dueDate: null });
    const smsByTone = Object.fromEntries(
      plan.map((p) => [p.tone, p.withSms]),
    );
    expect(smsByTone.gentle).toBe(false);
    expect(smsByTone.firm).toBe(true);
    expect(smsByTone.deadline).toBe(true);
  });

  it("orders the plan chronologically", () => {
    const plan = buildReminderPlan({ sentAt, dueDate: "2026-05-30" });
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].runAfter.getTime()).toBeGreaterThan(
        plan[i - 1].runAfter.getTime(),
      );
    }
  });
});

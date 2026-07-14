import { describe, it, expect } from "vitest";
import { buildReminderPlan } from "./reminders";
import { DEFAULT_REMINDER_SETTINGS } from "./reminder-settings";

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

  it("returns no jobs when automatic reminders are disabled", () => {
    const plan = buildReminderPlan({
      sentAt,
      dueDate: "2026-05-30",
      settings: { ...DEFAULT_REMINDER_SETTINGS, enabled: false },
    });
    expect(plan).toEqual([]);
  });

  it("uses customized timing and email copy", () => {
    const settings = structuredClone(DEFAULT_REMINDER_SETTINGS);
    settings.steps[0] = {
      ...settings.steps[0],
      days: 5,
      customSubject: "Documents for {engagement}",
      customMessage: "Hi {client}",
    };
    settings.steps[1].enabled = false;

    const plan = buildReminderPlan({ sentAt, dueDate: null, settings });
    expect(plan.map((step) => step.tone)).toEqual(["gentle", "deadline"]);
    expect(plan[0].runAfter.toISOString()).toBe("2026-05-06T12:00:00.000Z");
    expect(plan[0].customSubject).toBe("Documents for {engagement}");
    expect(plan[0].customMessage).toBe("Hi {client}");
  });

  it("uses the customized due-date offset for overdue reminders", () => {
    const settings = structuredClone(DEFAULT_REMINDER_SETTINGS);
    const overdue = settings.steps.find((step) => step.tone === "overdue")!;
    overdue.days = 3;

    const plan = buildReminderPlan({
      sentAt,
      dueDate: "2026-05-20",
      settings,
    });
    expect(plan.find((step) => step.tone === "overdue")?.runAfter.toISOString())
      .toBe("2026-05-23T23:59:59.000Z");
  });
});

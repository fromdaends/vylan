import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDER_SETTINGS } from "./reminder-settings";
import {
  getFirmReminderDefault,
  withReminderDefaultFallback,
} from "./reminder-defaults";

describe("firm reminder defaults", () => {
  it("prefers the dedicated column over the compatibility fallback", () => {
    const column = structuredClone(DEFAULT_REMINDER_SETTINGS);
    column.steps[0].days = 4;
    const fallback = structuredClone(DEFAULT_REMINDER_SETTINGS);
    fallback.steps[0].days = 9;

    expect(
      getFirmReminderDefault({
        default_reminder_settings: column,
        business_hours: { default_reminder_settings: fallback },
      })?.steps[0].days,
    ).toBe(4);
  });

  it("reads, writes, and removes the compatibility fallback", () => {
    const settings = structuredClone(DEFAULT_REMINDER_SETTINGS);
    settings.steps[1].repeatCount = 3;
    const stored = withReminderDefaultFallback({ monday: "09:00" }, settings);

    expect(getFirmReminderDefault({ business_hours: stored })?.steps[1].repeatCount).toBe(3);
    expect(withReminderDefaultFallback(stored, null)).toEqual({
      monday: "09:00",
    });
  });
});

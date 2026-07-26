import { describe, expect, it } from "vitest";
import {
  formatMessageTimestamp,
  shouldShowMessageTimestamp,
} from "./message-timeline";

describe("message timeline", () => {
  it("shows timestamps at the start, after an hour, and on a new day", () => {
    const messages = [
      { created_at: "2026-07-15T10:00:00Z" },
      { created_at: "2026-07-15T10:30:00Z" },
      { created_at: "2026-07-15T11:30:00Z" },
      { created_at: "2026-07-16T09:00:00Z" },
    ];

    expect(
      messages.map((_, index) =>
        shouldShowMessageTimestamp(messages, index),
      ),
    ).toEqual([true, false, true, true]);
  });

  it("formats old, recent, and same-day timestamps like a social chat", () => {
    const now = new Date("2026-07-25T16:00:00");

    expect(formatMessageTimestamp("2026-07-15T18:46:00", "en", now)).toMatch(
      /Jul 15, 2026.*6:46 p\.m\./i,
    );
    expect(formatMessageTimestamp("2026-07-22T12:34:00", "en", now)).toMatch(
      /Wed.*12:34 p\.m\./i,
    );
    expect(formatMessageTimestamp("2026-07-25T11:42:00", "en", now)).toMatch(
      /11:42 a\.m\./i,
    );
  });
});

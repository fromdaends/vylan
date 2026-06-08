import { describe, it, expect } from "vitest";
import { shouldSendWelcome } from "./welcome";

describe("shouldSendWelcome", () => {
  // A brand-new user landing for the first time: has an email, not a reset,
  // no firm/profile row yet, never welcomed → this is the one case that sends.
  const newUser = {
    hasEmail: true,
    isPasswordReset: false,
    hasUsersRow: false,
    alreadyWelcomed: false,
  } as const;

  it("sends for a brand-new, first-time signed-in user", () => {
    expect(shouldSendWelcome(newUser)).toBe(true);
  });

  it("does not send without an email to deliver to", () => {
    expect(shouldSendWelcome({ ...newUser, hasEmail: false })).toBe(false);
  });

  it("does not send on a password-reset landing", () => {
    expect(shouldSendWelcome({ ...newUser, isPasswordReset: true })).toBe(false);
  });

  it("does not send to a returning user who already has a firm/profile row", () => {
    expect(shouldSendWelcome({ ...newUser, hasUsersRow: true })).toBe(false);
  });

  it("does not send twice — already welcomed", () => {
    expect(shouldSendWelcome({ ...newUser, alreadyWelcomed: true })).toBe(false);
  });

  it("suppression wins even when other signals would allow a send", () => {
    // Each suppressing condition independently blocks the send.
    expect(
      shouldSendWelcome({ ...newUser, isPasswordReset: true, hasUsersRow: true }),
    ).toBe(false);
    expect(
      shouldSendWelcome({ ...newUser, hasEmail: false, alreadyWelcomed: true }),
    ).toBe(false);
  });
});

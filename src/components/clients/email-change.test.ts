import { describe, it, expect } from "vitest";
import { emailChangeNeedsConfirm } from "./email-change";

describe("emailChangeNeedsConfirm", () => {
  it("never confirms when creating a client (no prior address to protect)", () => {
    expect(emailChangeNeedsConfirm("create", null, "a@b.com")).toBe(false);
    expect(emailChangeNeedsConfirm("create", "old@b.com", "new@b.com")).toBe(
      false,
    );
  });

  it("does not confirm when the email is unchanged", () => {
    expect(emailChangeNeedsConfirm("edit", "a@b.com", "a@b.com")).toBe(false);
  });

  it("treats surrounding whitespace as no change", () => {
    expect(emailChangeNeedsConfirm("edit", "a@b.com", "  a@b.com  ")).toBe(
      false,
    );
  });

  it("confirms a genuine change", () => {
    expect(emailChangeNeedsConfirm("edit", "old@b.com", "new@b.com")).toBe(true);
  });

  it("confirms adding an email where there was none", () => {
    expect(emailChangeNeedsConfirm("edit", null, "new@b.com")).toBe(true);
    expect(emailChangeNeedsConfirm("edit", "", "new@b.com")).toBe(true);
  });

  it("confirms removing an existing email", () => {
    expect(emailChangeNeedsConfirm("edit", "old@b.com", "")).toBe(true);
  });

  it("does not confirm when both old and new are effectively empty", () => {
    expect(emailChangeNeedsConfirm("edit", null, "")).toBe(false);
    expect(emailChangeNeedsConfirm("edit", "", "   ")).toBe(false);
  });
});

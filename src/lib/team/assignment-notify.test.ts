import { describe, it, expect } from "vitest";
import { assignmentEmailDecision } from "./assignment-notify";

describe("assignmentEmailDecision", () => {
  const base = {
    currentAssigneeId: "u-me",
    targetAssigneeId: "u-me",
    assigneeDeactivated: false,
    assigneeEmail: "me@firm.ca",
    wasActiveSinceAssigned: false,
  };

  it("sends when still assigned, has an email, and hasn't been active", () => {
    expect(assignmentEmailDecision(base)).toBe("send");
  });

  it("skips when the engagement was reassigned to someone else", () => {
    expect(
      assignmentEmailDecision({ ...base, currentAssigneeId: "u-marie" }),
    ).toBe("reassigned_away");
  });

  it("skips when the assignee has been active since assigned (saw the in-app one)", () => {
    expect(
      assignmentEmailDecision({ ...base, wasActiveSinceAssigned: true }),
    ).toBe("already_active");
  });

  it("skips a deactivated recipient", () => {
    expect(
      assignmentEmailDecision({ ...base, assigneeDeactivated: true }),
    ).toBe("no_recipient");
  });

  it("skips a recipient with no email", () => {
    expect(
      assignmentEmailDecision({ ...base, assigneeEmail: null }),
    ).toBe("no_recipient");
  });

  it("prioritizes reassigned-away over active/recipient checks", () => {
    expect(
      assignmentEmailDecision({
        ...base,
        currentAssigneeId: "u-someone-else",
        wasActiveSinceAssigned: true,
        assigneeDeactivated: true,
      }),
    ).toBe("reassigned_away");
  });
});

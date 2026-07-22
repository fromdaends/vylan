import { describe, it, expect } from "vitest";
import {
  computeEngagementWorkload,
  workloadForMember,
} from "./workload";

describe("computeEngagementWorkload", () => {
  it("buckets active engagements per assignee with ready + attention counts", () => {
    const { byMember, unassigned } = computeEngagementWorkload([
      { assigneeUserId: "u1", readyToReview: true, daysOverdue: 0 },
      { assigneeUserId: "u1", readyToReview: false, daysOverdue: 3 },
      { assigneeUserId: "u1", readyToReview: true, daysOverdue: 5 },
      { assigneeUserId: "u2", readyToReview: false, daysOverdue: 0 },
      { assigneeUserId: null, readyToReview: true, daysOverdue: 2 },
    ]);
    expect(byMember.u1).toEqual({
      activeEngagements: 3,
      readyToReview: 2,
      needsAttention: 2,
    });
    expect(byMember.u2).toEqual({
      activeEngagements: 1,
      readyToReview: 0,
      needsAttention: 0,
    });
    expect(unassigned).toEqual({
      activeEngagements: 1,
      readyToReview: 1,
      needsAttention: 1,
    });
  });

  it("returns empty buckets for no rows", () => {
    const { byMember, unassigned } = computeEngagementWorkload([]);
    expect(byMember).toEqual({});
    expect(unassigned).toEqual({
      activeEngagements: 0,
      readyToReview: 0,
      needsAttention: 0,
    });
  });
});

describe("workloadForMember", () => {
  it("defaults to zeros for a member with nothing active", () => {
    expect(workloadForMember({}, "ghost")).toEqual({
      activeEngagements: 0,
      readyToReview: 0,
      needsAttention: 0,
    });
  });
});

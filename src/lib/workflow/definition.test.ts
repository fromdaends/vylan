import { describe, it, expect } from "vitest";
import {
  buildWorkflowSnapshot,
  bookkeepingWorkflow,
  familyDefaultWorkflow,
  gstWorkflow,
  onboardingWorkflow,
  parseStageGates,
  parseWorkflowDefinition,
  parseWorkflowSnapshot,
  returnTypeWorkflow,
  workflowStageOrder,
  type AssigneeContext,
} from "./definition";

describe("parseWorkflowDefinition — total reading", () => {
  it("degrades garbage to null (legacy behaviour), never throws", () => {
    for (const junk of [null, undefined, "", 42, [], "workflow", { a: 1 }]) {
      expect(parseWorkflowDefinition(junk)).toBeNull();
    }
  });

  it("fills every stage with safe defaults when stages are sparse", () => {
    const def = parseWorkflowDefinition({ stages: {} });
    expect(def).not.toBeNull();
    for (const s of Object.values(def!.stages)) {
      expect(s.skipped).toBe(false);
      expect(s.on_entry).toEqual([]);
      expect(s.tasks).toEqual([]);
      // A defaulted advance is null — nothing auto-fires from a shape a
      // newer build wrote and this one half-understood.
      expect(s.advance).toBeNull();
    }
  });

  it("refuses to skip collecting and completed (the spec's guard rail)", () => {
    const def = parseWorkflowDefinition({
      stages: {
        collecting: { skipped: true },
        completed: { skipped: true },
        in_review: { skipped: true },
      },
    })!;
    expect(def.stages.collecting.skipped).toBe(false);
    expect(def.stages.completed.skipped).toBe(false);
    expect(def.stages.in_review.skipped).toBe(true);
  });

  it("coerces stage_tasks_done over an empty task list to manual", () => {
    // Vacuously-true would let the stage fall straight through on entry.
    const def = parseWorkflowDefinition({
      stages: {
        in_preparation: {
          tasks: [],
          advance: { condition: "stage_tasks_done", mode: "automatic" },
        },
      },
    })!;
    expect(def.stages.in_preparation.advance).toEqual({
      condition: "manual",
      mode: "automatic",
    });
  });

  it("reads an unknown condition as manual and an unknown mode as automatic", () => {
    const def = parseWorkflowDefinition({
      stages: {
        in_review: {
          advance: { condition: "client_accepted", mode: "someday" },
        },
      },
    })!;
    // A condition from a newer build must never auto-fire on an older one.
    expect(def.stages.in_review.advance).toEqual({
      condition: "manual",
      mode: "automatic",
    });
  });

  it("drops unknown entry actions and keeps known ones in order", () => {
    const def = parseWorkflowDefinition({
      stages: {
        collecting: {
          on_entry: ["send_invoice", "summon_lawyer", "activate_checklist"],
        },
      },
    })!;
    expect(def.stages.collecting.on_entry).toEqual([
      "send_invoice",
      "activate_checklist",
    ]);
  });

  it("mirrors a one-language task title into the other", () => {
    const def = parseWorkflowDefinition({
      stages: {
        in_preparation: {
          tasks: [{ title_en: "Reconcile" }, { title_fr: "Réviser" }, {}],
        },
      },
    })!;
    expect(def.stages.in_preparation.tasks).toEqual([
      { title_en: "Reconcile", title_fr: "Reconcile", assignee: null },
      { title_en: "Réviser", title_fr: "Réviser", assignee: null },
    ]);
  });

  it("round-trips every family seed unchanged", () => {
    // The SQL seeds in 1560 are the same shapes — if these survive the parser
    // intact, so do the database rows. The parser's one normalization is
    // filling a task's omitted `assignee` with null.
    for (const def of [
      returnTypeWorkflow(),
      gstWorkflow(),
      bookkeepingWorkflow(),
      onboardingWorkflow(),
    ]) {
      const expected = structuredClone(def);
      for (const stage of Object.values(expected.stages)) {
        stage.tasks = stage.tasks.map((t) => ({ assignee: null, ...t }));
      }
      expect(
        parseWorkflowDefinition(JSON.parse(JSON.stringify(def))),
      ).toEqual(expected);
    }
  });
});

describe("family defaults", () => {
  it("bookkeeping skips the signature stage; returns don't", () => {
    expect(workflowStageOrder(bookkeepingWorkflow())).not.toContain(
      "awaiting_signature",
    );
    expect(workflowStageOrder(returnTypeWorkflow())).toContain(
      "awaiting_signature",
    );
  });

  it("onboarding walks exactly collecting → in_review → completed", () => {
    expect(workflowStageOrder(onboardingWorkflow())).toEqual([
      "collecting",
      "in_review",
      "completed",
    ]);
  });

  it("maps bookkeeping to its flow and everything else to the return flow", () => {
    expect(familyDefaultWorkflow("bookkeeping")).toEqual(bookkeepingWorkflow());
    expect(familyDefaultWorkflow("t1")).toEqual(returnTypeWorkflow());
    expect(familyDefaultWorkflow("t2")).toEqual(returnTypeWorkflow());
    expect(familyDefaultWorkflow("custom")).toEqual(returnTypeWorkflow());
  });
});

describe("buildWorkflowSnapshot — assignee resolution at instantiation", () => {
  const ctx: AssigneeContext = {
    ownerId: "owner-1",
    staffId: "staff-1",
    activeMemberIds: new Set(["owner-1", "staff-1", "member-9"]),
    fallbackId: "creator-1",
  };

  it("freezes owner and staff rules to user ids", () => {
    const snap = buildWorkflowSnapshot(returnTypeWorkflow(), ctx, "auto-1");
    expect(snap.assignees.collecting).toBe("staff-1");
    expect(snap.assignees.in_review).toBe("owner-1");
    expect(snap.assignees.in_preparation).toBe("staff-1");
    expect(snap.assignees.awaiting_signature).toBeUndefined();
    expect(snap.automation_id).toBe("auto-1");
  });

  it("falls back to the creator when the named person isn't an active member", () => {
    const def = parseWorkflowDefinition({
      stages: { collecting: { assignee: { member_id: "gone-user" } } },
    })!;
    const snap = buildWorkflowSnapshot(def, {
      ...ctx,
      staffId: null,
      fallbackId: "member-9",
    });
    expect(snap.assignees.collecting).toBe("member-9");
  });

  it("survives a context where nothing resolves", () => {
    const snap = buildWorkflowSnapshot(returnTypeWorkflow(), {
      ownerId: null,
      staffId: null,
      activeMemberIds: new Set(),
      fallbackId: null,
    });
    expect(snap.assignees).toEqual({});
  });
});

describe("parseWorkflowSnapshot / parseStageGates", () => {
  it("keeps resolved assignees and provenance", () => {
    const snap = buildWorkflowSnapshot(
      bookkeepingWorkflow(),
      {
        ownerId: "o",
        staffId: "s",
        activeMemberIds: new Set(["o", "s"]),
        fallbackId: "o",
      },
      "auto-3",
    );
    const parsed = parseWorkflowSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed?.assignees).toEqual(snap.assignees);
    expect(parsed?.automation_id).toBe("auto-3");
  });

  it("reads junk gates as none latched", () => {
    for (const junk of [null, "x", 3, [], { in_review: "yes" }]) {
      expect(parseStageGates(junk)).toEqual({});
    }
    expect(
      parseStageGates({ in_review: { by: "u1", at: "2026-08-04T00:00:00Z" } }),
    ).toEqual({ in_review: { by: "u1", at: "2026-08-04T00:00:00Z" } });
  });
});

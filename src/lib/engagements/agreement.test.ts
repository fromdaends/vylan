// Where the agreement is.
//
// The rule this whole module exists to enforce: these words must stay true
// however many things are running inside the engagement. Most of what is tested
// here is therefore about what does NOT change the answer — parallel work, task
// counts, how far along any individual thing is.

import { describe, expect, it } from "vitest";
import {
  agreementStatusForRow,
  isClosed,
  resolveAgreementStatus,
  workSummary,
  type AgreementFacts,
} from "./agreement";

function facts(over: Partial<AgreementFacts> = {}): AgreementFacts {
  return {
    status: "sent",
    sentAt: "2026-08-01T00:00:00Z",
    completedAt: null,
    clientHasEngaged: false,
    ...over,
  };
}

describe("resolveAgreementStatus", () => {
  it("is draft until it has actually been sent", () => {
    expect(resolveAgreementStatus(facts({ status: "draft", sentAt: null })))
      .toBe("draft");
    // A full scope, a price and a checklist still add up to something nobody
    // has seen. Never-sent beats everything except cancelled/complete.
    expect(resolveAgreementStatus(facts({ status: "in_progress", sentAt: null })))
      .toBe("draft");
  });

  it("is sent once the client has it and has done nothing yet", () => {
    expect(resolveAgreementStatus(facts())).toBe("sent");
  });

  it("becomes active the moment the client does anything", () => {
    expect(resolveAgreementStatus(facts({ clientHasEngaged: true })))
      .toBe("active");
  });

  it("is active when the firm has started, even in silence from the client", () => {
    expect(resolveAgreementStatus(facts({ status: "in_progress" })))
      .toBe("active");
  });

  it("is complete when it is complete", () => {
    expect(resolveAgreementStatus(facts({ status: "complete" }))).toBe("complete");
    expect(resolveAgreementStatus(facts({ completedAt: "2026-08-02T00:00:00Z" })))
      .toBe("complete");
  });

  it("lets cancelled win over everything", () => {
    expect(
      resolveAgreementStatus(
        facts({ status: "cancelled", completedAt: "2026-08-02T00:00:00Z" }),
      ),
    ).toBe("cancelled");
  });
});

describe("resolveAgreementStatus — acceptance", () => {
  it("reads accepted-but-untouched as its own state", () => {
    // Real and actionable: the client has agreed and nothing has happened
    // since, which makes it the FIRM's move rather than the client's.
    expect(
      resolveAgreementStatus(
        facts({ acceptedAt: "2026-08-02T00:00:00Z", clientHasEngaged: false }),
      ),
    ).toBe("accepted");
  });

  it("moves to active once work starts after acceptance", () => {
    expect(
      resolveAgreementStatus(
        facts({ acceptedAt: "2026-08-02T00:00:00Z", clientHasEngaged: true }),
      ),
    ).toBe("active");
  });

  it("treats a missing acceptedAt as NOT accepted", () => {
    // Every engagement created before the accept step exists has no acceptedAt.
    // Defaulting the other way would silently mark all of them as agreed to by
    // a client who was never asked.
    expect(resolveAgreementStatus(facts({ acceptedAt: null }))).toBe("sent");
    expect(resolveAgreementStatus(facts({ acceptedAt: undefined }))).toBe("sent");
  });
});

describe("the words do not change when the work does", () => {
  // The entire reason this replaces the stage cascade. One task waiting on a
  // signature used to make the WHOLE engagement read "Awaiting signature" while
  // four others were mid-preparation.
  it("says the same thing regardless of how much work is in flight", () => {
    const base = facts({ clientHasEngaged: true });
    // There is deliberately no task input to this function at all — the point
    // is structural, not a matter of getting the weighting right.
    expect(resolveAgreementStatus(base)).toBe("active");
    expect(resolveAgreementStatus({ ...base })).toBe("active");
  });
});

describe("workSummary", () => {
  it("counts rather than labels", () => {
    expect(
      workSummary([{ done: true }, { done: false }, { done: true }]),
    ).toEqual({ done: 2, total: 3 });
  });

  it("returns null when there is nothing to describe", () => {
    // So a caller renders nothing rather than "0 of 0".
    expect(workSummary([])).toBeNull();
  });

  it("stays honest as work is added", () => {
    // A count cannot become misleading when a seventh task starts, which is
    // precisely what any single adjective could.
    const six = Array.from({ length: 6 }, (_, i) => ({ done: i < 3 }));
    expect(workSummary(six)).toEqual({ done: 3, total: 6 });
    expect(workSummary([...six, { done: false }])).toEqual({ done: 3, total: 7 });
  });
});

describe("isClosed", () => {
  it("treats complete and cancelled as finished with", () => {
    expect(isClosed("complete")).toBe(true);
    expect(isClosed("cancelled")).toBe(true);
    for (const s of ["draft", "sent", "accepted", "active"] as const) {
      expect(isClosed(s)).toBe(false);
    }
  });
});

describe("agreementStatusForRow", () => {
  const row = (over: Partial<Parameters<typeof agreementStatusForRow>[0]> = {}) => ({
    status: "sent" as const,
    startedAt: "2026-08-01T00:00:00Z",
    daysSinceClientActivity: null,
    ...over,
  });

  it("reads a draft as draft even though startedAt falls back to created_at", () => {
    // startedAt is `sent_at ?? created_at`, so a never-sent draft still has a
    // date in it. The status gate has to come first or every draft reads sent.
    expect(agreementStatusForRow(row({ status: "draft" }))).toBe("draft");
  });

  it("treats any client activity as engagement", () => {
    expect(agreementStatusForRow(row({ daysSinceClientActivity: 0 }))).toBe("active");
    expect(agreementStatusForRow(row({ daysSinceClientActivity: 12 }))).toBe("active");
  });

  it("reads silence as still just sent", () => {
    expect(agreementStatusForRow(row())).toBe("sent");
  });

  it("passes through complete and cancelled", () => {
    expect(agreementStatusForRow(row({ status: "complete" }))).toBe("complete");
    expect(agreementStatusForRow(row({ status: "cancelled" }))).toBe("cancelled");
  });
});

describe("resolveAgreementStatus — explicit activation (1630)", () => {
  const sent = {
    status: "sent" as const,
    sentAt: "2026-01-01T00:00:00Z",
    completedAt: null,
    clientHasEngaged: false,
  };

  it("accepted but not activated stays ACCEPTED — the firm's move, not the client's", () => {
    expect(
      resolveAgreementStatus({ ...sent, acceptedAt: "2026-01-02T00:00:00Z" }),
    ).toBe("accepted");
  });

  it("activating makes it ACTIVE even with no client activity at all", () => {
    expect(
      resolveAgreementStatus({
        ...sent,
        acceptedAt: "2026-01-02T00:00:00Z",
        activatedAt: "2026-01-03T00:00:00Z",
      }),
    ).toBe("active");
  });

  it("client activity still promotes an engagement accepted before Activate existed", () => {
    expect(
      resolveAgreementStatus({
        ...sent,
        acceptedAt: "2026-01-02T00:00:00Z",
        clientHasEngaged: true,
      }),
    ).toBe("active");
  });

  it("activation NEVER skips acceptance — a stray value cannot promote an unaccepted engagement", () => {
    expect(
      resolveAgreementStatus({
        ...sent,
        acceptedAt: null,
        activatedAt: "2026-01-03T00:00:00Z",
      }),
    ).toBe("sent");
  });

  it("activation cannot resurrect a cancelled or completed engagement", () => {
    expect(
      resolveAgreementStatus({
        ...sent,
        status: "cancelled",
        acceptedAt: "2026-01-02T00:00:00Z",
        activatedAt: "2026-01-03T00:00:00Z",
      }),
    ).toBe("cancelled");
    expect(
      resolveAgreementStatus({
        ...sent,
        completedAt: "2026-02-01T00:00:00Z",
        acceptedAt: "2026-01-02T00:00:00Z",
        activatedAt: "2026-01-03T00:00:00Z",
      }),
    ).toBe("complete");
  });

  it("an unsent engagement is a draft however much else is set", () => {
    expect(
      resolveAgreementStatus({
        ...sent,
        status: "draft",
        sentAt: null,
        acceptedAt: "2026-01-02T00:00:00Z",
        activatedAt: "2026-01-03T00:00:00Z",
      }),
    ).toBe("draft");
  });
});

describe("⚠️ an engagement that asks for acceptance never claims one", () => {
  // The founder, looking at a sent proposal: "it says draft ✓ sent ✓ accepted ✓
  // ... It should not say accepted because it has not been accepted."
  //
  // The rail ticks every step BEFORE the current one, so returning "active"
  // here put a checkmark on "Accepted" — on a contract nobody signed.
  const sentNotAccepted = {
    status: "sent" as const,
    sentAt: "2026-08-07T23:36:52Z",
    acceptedAt: null,
    completedAt: null,
    requiresAcceptance: true,
  };

  it("stays SENT even when the client has opened it", () => {
    // `clientHasEngaged` was the stand-in "until acceptance exists". It exists.
    expect(
      resolveAgreementStatus({ ...sentNotAccepted, clientHasEngaged: true }),
    ).toBe("sent");
  });

  it("stays SENT even when the lifecycle column says in_progress", () => {
    // 31 of 80 production engagements were in exactly this shape.
    expect(
      resolveAgreementStatus({
        ...sentNotAccepted,
        status: "in_progress",
        clientHasEngaged: false,
      }),
    ).toBe("sent");
  });

  it("stays SENT even if something stamped activated_at", () => {
    // Activating what nobody agreed to must not skip the agreement.
    expect(
      resolveAgreementStatus({
        ...sentNotAccepted,
        clientHasEngaged: true,
        activatedAt: "2026-08-07T23:40:00Z",
      }),
    ).toBe("sent");
  });

  it("moves on the moment the client actually accepts", () => {
    expect(
      resolveAgreementStatus({
        ...sentNotAccepted,
        acceptedAt: "2026-08-08T10:00:00Z",
        clientHasEngaged: false,
      }),
    ).toBe("accepted");
  });

  it("still lets a completed engagement be complete", () => {
    // The most-final-first ordering must survive the new rule.
    expect(
      resolveAgreementStatus({
        ...sentNotAccepted,
        clientHasEngaged: true,
        completedAt: "2026-08-09T10:00:00Z",
      }),
    ).toBe("complete");
  });

  it("leaves engagements that never ask for acceptance alone", () => {
    // Historical rows, and firms that do not use the accept step. The old
    // stand-in is still the best reading there, with no real answer to overrule.
    expect(
      resolveAgreementStatus({
        ...sentNotAccepted,
        requiresAcceptance: false,
        clientHasEngaged: true,
      }),
    ).toBe("active");
  });
});

describe("the list and the detail page give the SAME answer", () => {
  // They used to disagree: the row derivation passed neither acceptedAt nor
  // requiresAcceptance, so a sent-unaccepted engagement read "active" in the
  // list while its own page read "sent". One job, two answers, and the wrong
  // one claimed a signed contract.
  it("a sent, unaccepted row is SENT in the list too", () => {
    expect(
      agreementStatusForRow({
        status: "sent",
        startedAt: "2026-08-07T23:36:52Z",
        daysSinceClientActivity: 0, // the client opened it
        acceptedAt: null,
        requiresAcceptance: true,
      }),
    ).toBe("sent");
  });

  it("agrees with resolveAgreementStatus on the same facts", () => {
    const facts = {
      status: "in_progress" as const,
      startedAt: "2026-08-07T23:36:52Z",
      daysSinceClientActivity: 2,
      acceptedAt: null,
      requiresAcceptance: true,
    };
    expect(agreementStatusForRow(facts)).toBe(
      resolveAgreementStatus({
        status: facts.status,
        sentAt: facts.startedAt,
        completedAt: null,
        clientHasEngaged: true,
        acceptedAt: null,
        requiresAcceptance: true,
      }),
    );
  });

  it("leaves rows that never ask for acceptance exactly as they were", () => {
    expect(
      agreementStatusForRow({
        status: "in_progress",
        startedAt: "2026-01-01T00:00:00Z",
        daysSinceClientActivity: 1,
      }),
    ).toBe("active");
  });
});

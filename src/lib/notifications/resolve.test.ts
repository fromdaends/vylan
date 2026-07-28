import { describe, it, expect } from "vitest";
import {
  muteKeysFor,
  resolveRecipients,
  type RecipientCandidate,
  type RecipientSettings,
} from "./resolve";
import { getNotificationEvent, type NotificationEvent } from "./catalog";

const settings: RecipientSettings = {
  emailEnabled: true,
  scope: "all_firm",
  emailMode: "instant",
  dailyDigestTime: "08:00",
  timezone: "America/Toronto",
  quietHoursEnabled: false,
  quietHoursStart: "20:00",
  quietHoursEnd: "07:00",
  pauseWeekends: false,
  emailDetailLevel: "full",
};

function candidate(
  userId: string,
  overrides: Partial<RecipientCandidate> = {},
): RecipientCandidate {
  return {
    userId,
    role: "staff",
    locale: "en",
    email: `${userId}@firm.test`,
    settings,
    pref: null,
    mutes: new Set<string>(),
    ...overrides,
  };
}

function event(key: string): NotificationEvent {
  const e = getNotificationEvent(key);
  if (!e) throw new Error(`unknown test event ${key}`);
  return e;
}

const noAssignees = new Set<string>();

describe("muteKeysFor", () => {
  it("includes the entity itself when it is an engagement or client", () => {
    expect(muteKeysFor({ entity: { type: "engagement", id: "e1" } })).toEqual([
      "engagement:e1",
    ]);
  });

  it("maps a child entity onto its parent engagement and client", () => {
    // Muting an engagement must silence its DOCUMENTS too, not just rows whose
    // entity is literally the engagement.
    expect(
      muteKeysFor({
        entity: { type: "document", id: "d1" },
        engagementId: "e1",
        clientId: "c1",
      }),
    ).toEqual(["engagement:e1", "client:c1"]);
  });

  it("de-duplicates when the entity IS the parent", () => {
    expect(
      muteKeysFor({ entity: { type: "engagement", id: "e1" }, engagementId: "e1" }),
    ).toEqual(["engagement:e1"]);
  });

  it("returns nothing for a firm-level event", () => {
    expect(muteKeysFor({ entity: null })).toEqual([]);
  });
});

describe("resolveRecipients", () => {
  it("delivers to everyone in the firm by default", () => {
    const r = resolveRecipients({
      event: event("document.uploaded"),
      actorId: null,
      candidates: [candidate("a"), candidate("b")],
      muteKeys: [],
      assignedUserIds: noAssignees,
      isEngagementScoped: true,
    });
    expect(r.recipients.map((x) => x.userId)).toEqual(["a", "b"]);
  });

  // ── Rule 1 / spec: owner-only events are hidden from staff ────────────────
  it("owner-only events never reach staff", () => {
    const r = resolveRecipients({
      event: event("billing.payment_failed"),
      actorId: null,
      candidates: [
        candidate("owner", { role: "owner" }),
        candidate("staff", { role: "staff" }),
      ],
      muteKeys: [],
      assignedUserIds: noAssignees,
      isEngagementScoped: false,
    });
    expect(r.recipients.map((x) => x.userId)).toEqual(["owner"]);
    expect(r.dropped).toContainEqual({ userId: "staff", reason: "owner_only" });
  });

  // ── Acceptance criterion 3 ────────────────────────────────────────────────
  it("never notifies the person who caused the event", () => {
    const r = resolveRecipients({
      event: event("engagement.completed"),
      actorId: "a",
      candidates: [candidate("a"), candidate("b")],
      muteKeys: [],
      assignedUserIds: noAssignees,
      isEngagementScoped: true,
    });
    expect(r.recipients.map((x) => x.userId)).toEqual(["b"]);
    expect(r.dropped).toContainEqual({ userId: "a", reason: "is_actor" });
  });

  // ── Acceptance criterion 1 ────────────────────────────────────────────────
  it("assigned_only users get nothing about engagements they are not on", () => {
    const narrow = { ...settings, scope: "assigned_only" as const };
    const r = resolveRecipients({
      event: event("document.uploaded"),
      actorId: null,
      candidates: [
        candidate("on-it", { settings: narrow }),
        candidate("not-on-it", { settings: narrow }),
        candidate("firm-wide"),
      ],
      muteKeys: [],
      assignedUserIds: new Set(["on-it"]),
      isEngagementScoped: true,
    });
    expect(r.recipients.map((x) => x.userId)).toEqual(["on-it", "firm-wide"]);
    expect(r.dropped).toContainEqual({
      userId: "not-on-it",
      reason: "not_assigned",
    });
  });

  it("assigned_only still receives firm-level events with no engagement", () => {
    // A dead QuickBooks connection isn't assigned to anyone — narrowing scope
    // must not silently hide events that have no engagement in the first place.
    const r = resolveRecipients({
      event: event("integration.sync_failed"),
      actorId: null,
      candidates: [
        candidate("owner", {
          role: "owner",
          settings: { ...settings, scope: "assigned_only" },
        }),
      ],
      muteKeys: [],
      assignedUserIds: noAssignees,
      isEngagementScoped: false,
    });
    expect(r.recipients.map((x) => x.userId)).toEqual(["owner"]);
  });

  it("an explicitly addressed recipient is NOT dropped by assigned_only scope", () => {
    // An @mention is addressed to a person. Scope answers "how much of the
    // firm do I want to hear about", and must not silently swallow a message
    // aimed at you — the author would get no error and the mention would
    // simply never arrive.
    const r = resolveRecipients({
      event: event("message.internal_mention"),
      actorId: "author",
      candidates: [
        candidate("mentioned", {
          settings: { ...settings, scope: "assigned_only" },
        }),
      ],
      muteKeys: [],
      assignedUserIds: noAssignees, // deliberately NOT the assignee
      isEngagementScoped: true,
      explicitRecipients: true,
    });
    expect(r.recipients.map((x) => x.userId)).toEqual(["mentioned"]);
  });

  it("still applies scope when the recipients were NOT explicit", () => {
    const r = resolveRecipients({
      event: event("message.internal_mention"),
      actorId: "author",
      candidates: [
        candidate("bystander", {
          settings: { ...settings, scope: "assigned_only" },
        }),
      ],
      muteKeys: [],
      assignedUserIds: noAssignees,
      isEngagementScoped: true,
    });
    expect(r.dropped).toContainEqual({
      userId: "bystander",
      reason: "not_assigned",
    });
  });

  // ── Rule 4 ────────────────────────────────────────────────────────────────
  it("drops users who muted the entity", () => {
    const r = resolveRecipients({
      event: event("document.uploaded"),
      actorId: null,
      candidates: [
        candidate("muted", { mutes: new Set(["engagement:e1"]) }),
        candidate("listening"),
      ],
      muteKeys: muteKeysFor({
        entity: { type: "document", id: "d1" },
        engagementId: "e1",
      }),
      assignedUserIds: noAssignees,
      isEngagementScoped: true,
    });
    expect(r.recipients.map((x) => x.userId)).toEqual(["listening"]);
    expect(r.dropped).toContainEqual({ userId: "muted", reason: "muted" });
  });

  it("a client mute silences an engagement notification under that client", () => {
    const r = resolveRecipients({
      event: event("document.uploaded"),
      actorId: null,
      candidates: [candidate("muted", { mutes: new Set(["client:c1"]) })],
      muteKeys: muteKeysFor({
        entity: { type: "engagement", id: "e1" },
        clientId: "c1",
      }),
      assignedUserIds: noAssignees,
      isEngagementScoped: true,
    });
    expect(r.recipients).toHaveLength(0);
  });

  // ── Rule 5 ────────────────────────────────────────────────────────────────
  it("falls back to catalog defaults when the user has no preference row", () => {
    // document.uploaded defaults: in-app on, email off.
    const r = resolveRecipients({
      event: event("document.uploaded"),
      actorId: null,
      candidates: [candidate("a")],
      muteKeys: [],
      assignedUserIds: noAssignees,
      isEngagementScoped: true,
    });
    expect(r.recipients[0].inApp).toBe(true);
    expect(r.recipients[0].email).toBe(false);
  });

  it("honours a stored preference over the catalog default", () => {
    const r = resolveRecipients({
      event: event("document.uploaded"),
      actorId: null,
      candidates: [candidate("a", { pref: { inApp: false, email: true } })],
      muteKeys: [],
      assignedUserIds: noAssignees,
      isEngagementScoped: true,
    });
    expect(r.recipients[0].inApp).toBe(false);
    expect(r.recipients[0].email).toBe(true);
  });

  it("drops the recipient entirely when both channels are off", () => {
    const r = resolveRecipients({
      event: event("document.uploaded"),
      actorId: null,
      candidates: [candidate("a", { pref: { inApp: false, email: false } })],
      muteKeys: [],
      assignedUserIds: noAssignees,
      isEngagementScoped: true,
    });
    expect(r.recipients).toHaveLength(0);
    expect(r.dropped).toContainEqual({
      userId: "a",
      reason: "all_channels_off",
    });
  });

  // ── Acceptance criterion 6 ────────────────────────────────────────────────
  it("a locked event ignores a stored preference that tries to switch it off", () => {
    // Even if a row somehow says both channels off, billing.payment_failed and
    // security-class events must still be delivered.
    const r = resolveRecipients({
      event: event("billing.payment_failed"),
      actorId: null,
      candidates: [
        candidate("owner", {
          role: "owner",
          pref: { inApp: false, email: false },
        }),
      ],
      muteKeys: [],
      assignedUserIds: noAssignees,
      isEngagementScoped: false,
    });
    expect(r.recipients).toHaveLength(1);
    expect(r.recipients[0].inApp).toBe(true);
    expect(r.recipients[0].email).toBe(true);
  });

  it("a locked event is still not sent to the person who caused it", () => {
    // Locking a switch overrides preferences, NOT the actor rule — otherwise an
    // owner disconnecting an integration would email themselves about it.
    const r = resolveRecipients({
      event: event("integration.disconnected"),
      actorId: "owner",
      candidates: [candidate("owner", { role: "owner" })],
      muteKeys: [],
      assignedUserIds: noAssignees,
      isEngagementScoped: false,
    });
    expect(r.recipients).toHaveLength(0);
  });

  it("applies the rules in the documented order", () => {
    // The actor is also on assigned_only and has muted the engagement: the
    // FIRST matching rule should be the recorded reason.
    const r = resolveRecipients({
      event: event("document.uploaded"),
      actorId: "a",
      candidates: [
        candidate("a", {
          settings: { ...settings, scope: "assigned_only" },
          mutes: new Set(["engagement:e1"]),
        }),
      ],
      muteKeys: ["engagement:e1"],
      assignedUserIds: noAssignees,
      isEngagementScoped: true,
    });
    expect(r.dropped).toEqual([{ userId: "a", reason: "is_actor" }]);
  });
});

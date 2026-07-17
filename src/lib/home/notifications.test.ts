import { describe, it, expect } from "vitest";
import {
  filterNotificationsForViewer,
  eventActionToNotificationKind,
  shouldNotifyAssignee,
  type HomeNotification,
} from "./notifications";

describe("eventActionToNotificationKind", () => {
  it("maps payment + lifecycle actions to notification kinds", () => {
    expect(eventActionToNotificationKind("client_paid")).toBe("client_paid");
    expect(eventActionToNotificationKind("payment_failed")).toBe(
      "payment_failed",
    );
    expect(eventActionToNotificationKind("complete_engagement")).toBe(
      "engagement_completed",
    );
    expect(eventActionToNotificationKind("signature_signed")).toBe(
      "client_signed",
    );
    expect(eventActionToNotificationKind("client_message_sent")).toBe(
      "client_message",
    );
  });

  it("returns null for actions that aren't surfaced as notifications", () => {
    expect(eventActionToNotificationKind("payment_requested")).toBeNull();
    expect(eventActionToNotificationKind("reopen_engagement")).toBeNull();
    expect(eventActionToNotificationKind("anything_else")).toBeNull();
  });
});

function notif(
  over: Partial<HomeNotification> &
    Pick<HomeNotification, "id" | "engagement_id">,
): HomeNotification {
  return {
    kind: "ready_to_review",
    engagement_title: "Engagement",
    client_display_name: "Client",
    timestamp: "2026-06-01T00:00:00.000Z",
    href: "/engagements/x",
    ...over,
  };
}

describe("filterNotificationsForViewer", () => {
  const notifs = [
    notif({ id: "1", engagement_id: "e1" }), // -> alice
    notif({ id: "2", engagement_id: "e2" }), // -> bob
    notif({ id: "3", engagement_id: "e3" }), // -> carol (e.g. deactivated)
    notif({ id: "4", engagement_id: null }), // not engagement-scoped
  ];
  const assignee = new Map<string, string | null>([
    ["e1", "alice"],
    ["e2", "bob"],
    ["e3", "carol"],
  ]);

  it("owners see everything (firm-wide)", () => {
    expect(
      filterNotificationsForViewer(notifs, assignee, {
        userId: "alice",
        isOwner: true,
      }).map((n) => n.id),
    ).toEqual(["1", "2", "3", "4"]);
  });

  it("an unspecified viewer sees everything (back-compat)", () => {
    expect(filterNotificationsForViewer(notifs, assignee, undefined)).toHaveLength(
      4,
    );
  });

  it("staff see only notifications for engagements assigned to them", () => {
    expect(
      filterNotificationsForViewer(notifs, assignee, {
        userId: "alice",
        isOwner: false,
      }).map((n) => n.id),
    ).toEqual(["1"]);
    expect(
      filterNotificationsForViewer(notifs, assignee, {
        userId: "bob",
        isOwner: false,
      }).map((n) => n.id),
    ).toEqual(["2"]);
  });

  it("staff never see non-engagement notifications (those route to the owner)", () => {
    const r = filterNotificationsForViewer(notifs, assignee, {
      userId: "alice",
      isOwner: false,
    });
    expect(r.find((n) => n.engagement_id == null)).toBeUndefined();
  });

  it("a staff member with nothing assigned sees nothing", () => {
    expect(
      filterNotificationsForViewer(notifs, assignee, {
        userId: "dave",
        isOwner: false,
      }),
    ).toEqual([]);
  });
});

describe("shouldNotifyAssignee", () => {
  const base = {
    toUserId: "u-me",
    actorId: "u-boss",
    currentAssigneeId: "u-me",
    viewerId: "u-me",
  };

  it("notifies when someone else assigned it to me and I'm still the assignee", () => {
    expect(shouldNotifyAssignee(base)).toBe(true);
  });

  it("does not notify when I assigned it to myself", () => {
    expect(shouldNotifyAssignee({ ...base, actorId: "u-me" })).toBe(false);
  });

  it("does not notify when it was assigned to someone else", () => {
    expect(
      shouldNotifyAssignee({ ...base, toUserId: "u-marie" }),
    ).toBe(false);
  });

  it("does not notify on a stale row (since reassigned away from me)", () => {
    expect(
      shouldNotifyAssignee({ ...base, currentAssigneeId: "u-marie" }),
    ).toBe(false);
  });

  it("does not notify when there was no target user", () => {
    expect(shouldNotifyAssignee({ ...base, toUserId: null })).toBe(false);
  });
});

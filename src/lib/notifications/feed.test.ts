import { describe, it, expect } from "vitest";
import { groupByDay, localDayKey, showsInFeed, toFeedItem } from "./feed";
import { getNotificationEvent, NOTIFICATION_EVENTS } from "./catalog";
import type { NotificationRow } from "@/lib/db/notifications";

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n1",
    firm_id: "f1",
    user_id: "u1",
    event_key: "document.uploaded",
    entity_type: "engagement",
    entity_id: "e1",
    actor_id: null,
    payload: {},
    read_at: null,
    dismissed_at: null,
    email_sent_at: null,
    created_at: "2026-07-27T15:00:00.000Z",
    ...overrides,
  };
}

describe("toFeedItem", () => {
  it("maps a row onto its catalog label and destination", () => {
    const item = toFeedItem(
      row({
        payload: {
          client_name: "Gestion Lavoie",
          engagement_title: "T1 2025",
          count: 4,
        },
      }),
    );
    expect(item).not.toBeNull();
    expect(item!.labelKey).toBe("event_document_uploaded_label");
    expect(item!.category).toBe("documents");
    expect(item!.href).toBe("/engagements/e1");
    expect(item!.clientName).toBe("Gestion Lavoie");
    expect(item!.count).toBe(4);
  });

  it("drops a row whose event has been retired from the catalog", () => {
    // Otherwise the feed would render a blank line with a raw i18n key in it.
    expect(toFeedItem(row({ event_key: "retired.event" }))).toBeNull();
  });

  it("normalises a missing or nonsense count to 1", () => {
    expect(toFeedItem(row({ payload: {} }))!.count).toBe(1);
    expect(toFeedItem(row({ payload: { count: 0 } }))!.count).toBe(1);
    expect(toFeedItem(row({ payload: { count: "many" } }))!.count).toBe(1);
  });

  it("carries read state through", () => {
    expect(toFeedItem(row())!.readAt).toBeNull();
    expect(
      toFeedItem(row({ read_at: "2026-07-27T16:00:00.000Z" }))!.readAt,
    ).toBe("2026-07-27T16:00:00.000Z");
  });

  it("has a label key for every catalog event", () => {
    for (const e of NOTIFICATION_EVENTS) {
      const item = toFeedItem(row({ event_key: e.key }));
      expect(item, `no feed item for ${e.key}`).not.toBeNull();
      expect(item!.labelKey).toMatch(/^event_[a-z_]+_label$/);
    }
  });
});

describe("day grouping", () => {
  it("buckets by the VIEWER's day, not UTC's", () => {
    // 01:00 UTC on the 28th is 21:00 on the 27th in Toronto. Bucketing on the
    // raw ISO string would file this under tomorrow and show "Today" wrongly.
    expect(localDayKey("2026-07-28T01:00:00.000Z", "America/Toronto")).toBe(
      "2026-07-27",
    );
    expect(localDayKey("2026-07-28T01:00:00.000Z", "UTC")).toBe("2026-07-28");
  });

  it("keeps groups in feed order and does not reorder items", () => {
    const items = [
      toFeedItem(row({ id: "a", created_at: "2026-07-28T15:00:00.000Z" }))!,
      toFeedItem(row({ id: "b", created_at: "2026-07-28T09:00:00.000Z" }))!,
      toFeedItem(row({ id: "c", created_at: "2026-07-27T09:00:00.000Z" }))!,
    ];
    const groups = groupByDay(items, "America/Toronto");
    expect(groups.map((g) => g.day)).toEqual(["2026-07-28", "2026-07-27"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["c"]);
  });

  it("re-groups when the same instants are read in another timezone", () => {
    const items = [
      toFeedItem(row({ id: "a", created_at: "2026-07-28T01:00:00.000Z" }))!,
    ];
    expect(groupByDay(items, "America/Toronto")[0].day).toBe("2026-07-27");
    expect(groupByDay(items, "America/Halifax")[0].day).toBe("2026-07-27");
    expect(groupByDay(items, "UTC")[0].day).toBe("2026-07-28");
  });

  it("falls back rather than throwing on a bad timezone", () => {
    expect(() => localDayKey("2026-07-28T01:00:00.000Z", "Not/AZone")).not.toThrow();
  });
});

describe("catalog / feed consistency", () => {
  it("every catalog event resolves to a real category", () => {
    for (const e of NOTIFICATION_EVENTS) {
      expect(getNotificationEvent(e.key)!.category).toBe(e.category);
    }
  });
});

describe("showsInFeed", () => {
  it("hides a row written for email only", () => {
    // A user with In-app OFF but Email ON still gets a row (the email hangs
    // off it). If the feed showed it anyway, the In-app switch would be
    // decorative.
    expect(showsInFeed(row({ payload: { in_app: false } }))).toBe(false);
  });

  it("shows a normal row", () => {
    expect(showsInFeed(row({ payload: { in_app: true } }))).toBe(true);
  });

  it("shows a row written before the flag existed", () => {
    // An old notification quietly vanishing is worse than one extra row.
    expect(showsInFeed(row({ payload: {} }))).toBe(true);
  });
});

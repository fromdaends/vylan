import { describe, it, expect } from "vitest";
import {
  DEFERRED_EVENT_KEYS,
  NOTIFICATION_EVENTS,
  descriptionKeyFor,
  eventsByCategory,
  eventsForRole,
  getNotificationEvent,
  isNotificationEventKey,
  labelKeyFor,
} from "./catalog";
import { copyFor, copyKeys } from "./email-copy";
import { defaultRecipientSettings } from "@/lib/db/notifications";

describe("notification catalog", () => {
  it("has no duplicate keys", () => {
    const keys = NOTIFICATION_EVENTS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never lists a deferred event as shippable", () => {
    // The two lists must stay disjoint, or the settings UI would show a switch
    // for something that can never fire.
    const live = new Set(NOTIFICATION_EVENTS.map((e) => e.key));
    for (const deferred of DEFERRED_EVENT_KEYS) {
      expect(live.has(deferred)).toBe(false);
    }
  });

  it("gives every event a category, sort order and channel defaults", () => {
    for (const e of NOTIFICATION_EVENTS) {
      expect(e.key).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(typeof e.defaultInApp).toBe("boolean");
      expect(typeof e.defaultEmail).toBe("boolean");
      expect(e.sortOrder).toBeGreaterThan(0);
    }
  });

  it("keeps sort order unique within each category", () => {
    const byCategory = new Map<string, number[]>();
    for (const e of NOTIFICATION_EVENTS) {
      byCategory.set(e.category, [
        ...(byCategory.get(e.category) ?? []),
        e.sortOrder,
      ]);
    }
    for (const [, orders] of byCategory) {
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it("never ships an event that is locked on but off by default", () => {
    // can_disable:false means "you cannot turn this off". An event that is
    // simultaneously off by default would be permanently unreachable.
    for (const e of NOTIFICATION_EVENTS) {
      if (!e.canDisable) {
        expect(e.defaultInApp).toBe(true);
        expect(e.defaultEmail).toBe(true);
      }
    }
  });

  it("looks events up and rejects unknown keys", () => {
    expect(getNotificationEvent("document.uploaded")?.category).toBe("documents");
    expect(getNotificationEvent("nope.nope")).toBeNull();
    expect(isNotificationEventKey("payment.received")).toBe(true);
    expect(isNotificationEventKey("payment.imaginary")).toBe(false);
  });

  it("hides owner-only events from staff entirely", () => {
    const staff = eventsForRole("staff");
    expect(staff.some((e) => e.ownerOnly)).toBe(false);
    const owner = eventsForRole("owner");
    expect(owner.length).toBeGreaterThan(staff.length);
    expect(staff.some((e) => e.key === "billing.payment_failed")).toBe(false);
    expect(owner.some((e) => e.key === "billing.payment_failed")).toBe(true);
  });

  it("groups by category in catalog order, dropping empty groups for staff", () => {
    const groups = eventsByCategory("staff");
    expect(groups.map((g) => g.category)).toEqual([
      "documents",
      "engagements",
      "signatures",
      "payments",
      "messages",
      "clients",
    ]);
    // 'firm' is entirely owner-only, so staff never see the heading at all.
    expect(groups.some((g) => g.category === "firm")).toBe(false);
    for (const g of groups) {
      const orders = g.events.map((e) => e.sortOrder);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    }
  });

  it("derives i18n keys deterministically from the event key", () => {
    expect(labelKeyFor("document.uploaded")).toBe("event_document_uploaded_label");
    expect(descriptionKeyFor("billing.payment_failed")).toBe(
      "event_billing_payment_failed_desc",
    );
  });
});

describe("email copy", () => {
  it("has EN and FR copy for every catalog event", () => {
    for (const e of NOTIFICATION_EVENTS) {
      expect(copyFor(e.key, "en"), `missing EN copy for ${e.key}`).toBeTruthy();
      expect(copyFor(e.key, "fr"), `missing FR copy for ${e.key}`).toBeTruthy();
    }
  });

  it("has no copy for events that are not in the catalog", () => {
    const live = new Set(NOTIFICATION_EVENTS.map((e) => e.key));
    for (const key of copyKeys("en")) {
      expect(live.has(key), `orphan EN copy for ${key}`).toBe(true);
    }
    for (const key of copyKeys("fr")) {
      expect(live.has(key), `orphan FR copy for ${key}`).toBe(true);
    }
  });

  it("keeps EN and FR at exact parity", () => {
    expect(copyKeys("fr")).toEqual(copyKeys("en"));
  });

  it("writes French that reads as Quebec professional French", () => {
    const fr = copyFor("document.request_complete", "fr");
    expect(fr?.headline({
      clientName: "Gestion Lavoie",
      engagementTitle: null,
      documentName: null,
      amount: null,
      actorName: null,
      count: 1,
      detailed: true,
    })).toBe("Gestion Lavoie a envoyé tout ce que vous aviez demandé");
    // House style: no em-dashes anywhere in email copy.
    for (const key of copyKeys("fr")) {
      const c = copyFor(key, "fr")!;
      expect(c.cta).not.toContain("—");
    }
  });

  it("never leaks a name when detail is withheld", () => {
    // Every headline must be safe at minimal detail, in both languages.
    for (const locale of ["en", "fr"] as const) {
      for (const e of NOTIFICATION_EVENTS) {
        const line = copyFor(e.key, locale)!.headline({
          clientName: "Gestion Lavoie",
          engagementTitle: "T1 2025",
          documentName: "T4-slip.pdf",
          amount: "$1,250.00",
          actorName: "Marie Tremblay",
          count: 3,
          detailed: false,
        });
        expect(line, `${locale}/${e.key} leaked a client name`).not.toContain(
          "Gestion Lavoie",
        );
        expect(line).not.toContain("T4-slip.pdf");
        expect(line).not.toContain("1,250.00");
        expect(line).not.toContain("Marie Tremblay");
        expect(line).not.toContain("T1 2025");
      }
    }
  });

  it("pluralises bundled counts", () => {
    const vars = {
      clientName: "Gestion Lavoie",
      engagementTitle: null,
      documentName: null,
      amount: null,
      actorName: null,
      count: 5,
      detailed: true,
    };
    expect(copyFor("document.uploaded", "en")!.headline(vars)).toContain("5 new");
    expect(copyFor("document.uploaded", "fr")!.headline(vars)).toContain(
      "5 nouveaux",
    );
    expect(
      copyFor("document.uploaded", "en")!.headline({ ...vars, count: 1 }),
    ).toContain("New document");
  });
});

describe("default recipient settings", () => {
  it("defaults STAFF to assigned_only, matching what they already see", () => {
    // The old derived feed showed staff only their own engagements. Defaulting
    // them to all_firm would silently widen every staff member's view to every
    // client in the firm the moment this shipped.
    expect(defaultRecipientSettings("America/Toronto", "staff").scope).toBe(
      "assigned_only",
    );
  });

  it("defaults OWNERS to the whole firm", () => {
    expect(defaultRecipientSettings("America/Toronto", "owner").scope).toBe(
      "all_firm",
    );
  });

  it("takes the firm's timezone rather than hardcoding Eastern", () => {
    expect(defaultRecipientSettings("America/Vancouver", "owner").timezone).toBe(
      "America/Vancouver",
    );
    expect(defaultRecipientSettings(null, "owner").timezone).toBe(
      "America/Toronto",
    );
  });
});

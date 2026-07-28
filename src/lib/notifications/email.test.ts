import { describe, it, expect, beforeAll } from "vitest";
import {
  buildDigestEmail,
  buildNotificationEmail,
  hrefFor,
  toCopyVars,
} from "./email";
import type { NotificationRow } from "@/lib/db/notifications";

beforeAll(() => {
  process.env.APP_URL = "https://app.vylan.test";
});

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n1",
    firm_id: "f1",
    user_id: "u1",
    event_key: "document.uploaded",
    entity_type: "engagement",
    entity_id: "e1",
    actor_id: null,
    payload: {
      client_name: "Gestion Lavoie",
      engagement_title: "T1 2025",
      document_name: "T4-slip.pdf",
      amount: "$1,250.00",
      count: 1,
    },
    read_at: null,
    dismissed_at: null,
    email_sent_at: null,
    created_at: "2026-07-27T12:00:00.000Z",
    ...overrides,
  };
}

describe("hrefFor", () => {
  it("prefers an explicit href from the payload", () => {
    expect(hrefFor(row({ payload: { href: "/engagements/x?panel=messages" } }))).toBe(
      "/engagements/x?panel=messages",
    );
  });

  it("ignores an absolute or off-site href from a payload", () => {
    // Payloads are written by our own call sites, but a notification link is a
    // click target in an email — it must never be able to point off-app.
    expect(hrefFor(row({ payload: { href: "https://evil.test/phish" } }))).toBe(
      "/engagements/e1",
    );
  });

  it("rejects a protocol-relative href", () => {
    // "//evil.test/x" starts with "/" but resolves off-site in an href, so a
    // naive startsWith("/") check would leak a phishing link into an email.
    expect(hrefFor(row({ payload: { href: "//evil.test/phish" } }))).toBe(
      "/engagements/e1",
    );
  });

  it("derives a destination from the entity when no href is given", () => {
    expect(hrefFor(row({ payload: {} }))).toBe("/engagements/e1");
    expect(
      hrefFor(row({ payload: {}, entity_type: "client", entity_id: "c1" })),
    ).toBe("/clients/c1");
  });

  it("falls back to the feed rather than a dead link", () => {
    expect(
      hrefFor(row({ payload: {}, entity_type: null, entity_id: null })),
    ).toBe("/notifications");
  });
});

describe("toCopyVars", () => {
  it("passes detail through at full", () => {
    const v = toCopyVars(row(), "full");
    expect(v.clientName).toBe("Gestion Lavoie");
    expect(v.amount).toBe("$1,250.00");
    expect(v.detailed).toBe(true);
  });

  it("blanks every identifying value at minimal", () => {
    const v = toCopyVars(row(), "minimal");
    expect(v.clientName).toBeNull();
    expect(v.engagementTitle).toBeNull();
    expect(v.documentName).toBeNull();
    expect(v.amount).toBeNull();
    expect(v.actorName).toBeNull();
    expect(v.detailed).toBe(false);
  });
});

describe("buildNotificationEmail", () => {
  it("renders a full-detail email with a working link", () => {
    const built = buildNotificationEmail({
      row: row(),
      recipientName: "Marie",
      locale: "en",
      detailLevel: "full",
    });
    expect(built).toBeTruthy();
    expect(built!.subject).toContain("Gestion Lavoie");
    expect(built!.html).toContain("Hi Marie,");
    expect(built!.html).toContain(
      "https://app.vylan.test/en/engagements/e1",
    );
    expect(built!.text).toContain("https://app.vylan.test/en/engagements/e1");
  });

  it("renders in French for a French recipient", () => {
    const built = buildNotificationEmail({
      row: row(),
      recipientName: "Marie",
      locale: "fr",
      detailLevel: "full",
    });
    expect(built!.html).toContain("Bonjour Marie,");
    expect(built!.html).toContain("/fr/engagements/e1");
    expect(built!.html).toContain("Préférences de notification");
  });

  // The whole point of the minimal setting.
  it("leaks nothing identifying at minimal detail, subject included", () => {
    const built = buildNotificationEmail({
      row: row(),
      recipientName: "Marie",
      locale: "en",
      detailLevel: "minimal",
    });
    const everything = `${built!.subject}\n${built!.html}\n${built!.text}`;
    expect(everything).not.toContain("Gestion Lavoie");
    expect(everything).not.toContain("T1 2025");
    expect(everything).not.toContain("T4-slip.pdf");
    expect(everything).not.toContain("1,250.00");
    expect(built!.subject).toBe("You have new activity in Vylan.");
  });

  it("escapes HTML in names rather than injecting it", () => {
    const built = buildNotificationEmail({
      row: row({
        payload: { client_name: '<img src=x onerror="alert(1)">', count: 1 },
      }),
      recipientName: null,
      locale: "en",
      detailLevel: "full",
    });
    expect(built!.html).not.toContain("<img src=x");
    expect(built!.html).toContain("&lt;img");
  });

  it("carries a per-event opt-out link", () => {
    const built = buildNotificationEmail({
      row: row(),
      recipientName: null,
      locale: "en",
      detailLevel: "full",
    });
    expect(built!.html).toContain("tab=notifications&event=document.uploaded");
    expect(built!.html).toContain("Turn off this type of email");
  });

  it("returns null for an event with no copy instead of sending a blank", () => {
    expect(
      buildNotificationEmail({
        row: row({ event_key: "not.areal.event" }),
        recipientName: null,
        locale: "en",
        detailLevel: "full",
      }),
    ).toBeNull();
  });
});

describe("buildDigestEmail", () => {
  const rows = [
    row({ id: "a", event_key: "document.uploaded" }),
    row({ id: "b", event_key: "document.request_complete" }),
    row({ id: "c", event_key: "payment.received", entity_type: "invoice" }),
  ];

  it("groups by category with counts", () => {
    const built = buildDigestEmail({
      rows,
      recipientName: "Marie",
      locale: "en",
      detailLevel: "full",
    });
    expect(built!.subject).toBe("3 updates in Vylan");
    expect(built!.html).toContain("Documents (2)");
    expect(built!.html).toContain("Payments (1)");
  });

  it("deep-links each item", () => {
    const built = buildDigestEmail({
      rows,
      recipientName: null,
      locale: "en",
      detailLevel: "full",
    });
    expect(built!.html).toContain("https://app.vylan.test/en/engagements/e1");
  });

  it("uses the singular subject for one item", () => {
    const built = buildDigestEmail({
      rows: [rows[0]],
      recipientName: null,
      locale: "fr",
      detailLevel: "full",
    });
    expect(built!.subject).toBe("1 nouveauté dans Vylan");
  });

  it("says nothing specific at minimal detail", () => {
    const built = buildDigestEmail({
      rows,
      recipientName: null,
      locale: "en",
      detailLevel: "minimal",
    });
    const everything = `${built!.subject}\n${built!.html}\n${built!.text}`;
    expect(everything).not.toContain("Gestion Lavoie");
    expect(everything).not.toContain("Documents (2)");
  });

  it("returns null for an empty digest rather than an empty email", () => {
    expect(
      buildDigestEmail({
        rows: [],
        recipientName: null,
        locale: "en",
        detailLevel: "full",
      }),
    ).toBeNull();
  });

  it("skips rows whose event is no longer in the catalog", () => {
    const built = buildDigestEmail({
      rows: [rows[0], row({ id: "z", event_key: "retired.event" })],
      recipientName: null,
      locale: "en",
      detailLevel: "full",
    });
    expect(built!.html).toContain("Documents (1)");
  });
});

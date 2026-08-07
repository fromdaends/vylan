import { describe, expect, it } from "vitest";
import {
  ACTIVITY_CATEGORIES,
  CATEGORY_DOT,
  activityCategory,
  actorLabel,
  humaniseAction,
} from "@/lib/founders/actions";

describe("activityCategory", () => {
  it("puts engagement lifecycle events together", () => {
    expect(activityCategory("engagement_activated")).toBe("engagement");
    expect(activityCategory("engagement_archived")).toBe("engagement");
    expect(activityCategory("complete_engagement")).toBe("other"); // verb-first, no prefix
    expect(activityCategory("add_item")).toBe("engagement");
    expect(activityCategory("signature_requested")).toBe("engagement");
  });

  it("separates the engagement LETTER (an automation) from the engagement", () => {
    expect(activityCategory("engagement_letter_set")).toBe("automation");
    expect(activityCategory("engagement_reassigned")).toBe("engagement");
  });

  it("routes everything the client did to the portal bucket", () => {
    expect(activityCategory("client_uploaded")).toBe("portal");
    expect(activityCategory("client_viewed_portal")).toBe("portal");
    expect(activityCategory("proposal_accepted")).toBe("portal");
    expect(activityCategory("client_downloaded_deliverable")).toBe("portal");
  });

  it("keeps client MESSAGES out of the portal bucket", () => {
    expect(activityCategory("client_message_sent")).toBe("message");
  });

  it("keeps client MEMBERSHIP in the team bucket", () => {
    expect(activityCategory("client_member_added")).toBe("team");
    expect(activityCategory("client_member_removed")).toBe("team");
  });

  it("treats bookkeeping drafts as money", () => {
    expect(activityCategory("post_qbo_draft")).toBe("money");
    expect(activityCategory("qbo_draft_status")).toBe("money");
    expect(activityCategory("payment_recorded")).toBe("money");
    expect(activityCategory("invoice_voided")).toBe("money");
  });

  it("recognises AI, time and automation events", () => {
    expect(activityCategory("ai_classified")).toBe("ai");
    expect(activityCategory("time_entry_created")).toBe("time");
    expect(activityCategory("reminder_fired")).toBe("automation");
    expect(activityCategory("recurrence_spawned")).toBe("automation");
  });

  // The reason this module exists. New actions land in the log every time
  // somebody ships a feature; the console must never drop one.
  it("is TOTAL — an unknown action still gets a category", () => {
    expect(activityCategory("something_nobody_has_written_yet")).toBe("other");
    expect(activityCategory("")).toBe("other");
    expect(activityCategory(null)).toBe("other");
    expect(activityCategory(undefined)).toBe("other");
  });

  it("only ever returns a category that has a colour", () => {
    for (const action of [
      "engagement_activated",
      "client_uploaded",
      "invoice_voided",
      "ai_classified",
      "brand_new_unknown_thing",
    ]) {
      const c = activityCategory(action);
      expect(ACTIVITY_CATEGORIES).toContain(c);
      expect(CATEGORY_DOT[c]).toBeTruthy();
    }
  });
});

describe("humaniseAction", () => {
  it("turns snake_case into a sentence", () => {
    expect(humaniseAction("engagement_reassigned")).toBe("Engagement reassigned");
    expect(humaniseAction("client_marked_na")).toBe("Client marked N/A");
  });

  it("keeps initialisms upper-case wherever they sit", () => {
    expect(humaniseAction("qbo_draft_status")).toBe("QBO draft status");
    expect(humaniseAction("ai_classified")).toBe("AI classified");
    expect(humaniseAction("client_retry_sms_sent")).toBe("Client retry SMS sent");
    expect(humaniseAction("portal_pin_revealed")).toBe("Portal PIN revealed");
  });

  it("degrades readably rather than blankly", () => {
    expect(humaniseAction("a_completely_new_event")).toBe("A completely new event");
    expect(humaniseAction("")).toBe("Unknown");
    expect(humaniseAction(null)).toBe("Unknown");
    expect(humaniseAction("   ")).toBe("Unknown");
  });
});

describe("actorLabel", () => {
  it("passes through the two real actors", () => {
    expect(actorLabel("user")).toBe("user");
    expect(actorLabel("client")).toBe("client");
  });

  it("collapses anything unexpected to system rather than rendering it raw", () => {
    expect(actorLabel("system")).toBe("system");
    expect(actorLabel("robot")).toBe("system");
    expect(actorLabel(null)).toBe("system");
    expect(actorLabel(undefined)).toBe("system");
  });
});

import { describe, it, expect } from "vitest";
import { getNotificationEvent } from "./catalog";
import type { AttentionReason } from "@/lib/attention";

// The sweep translates an AttentionReason into a catalog key. This mapping is
// the single most breakable thing in that file, because the two vocabularies do
// NOT line up: the reason is "stale" and the event is "engagement.stalled".
//
// getNotificationEvent is an exact Map lookup, and notify() swallows an unknown
// key with only a console.error — so a mismatch here would silently stop the
// event firing forever, with a green test suite and no error anywhere a human
// would see. That is exactly what this test exists to prevent.
const REASON_TO_EVENT: Record<AttentionReason, string> = {
  overdue: "engagement.overdue",
  due_soon: "engagement.due_soon",
  stale: "engagement.stalled",
};

describe("attention reason -> catalog event mapping", () => {
  it("maps every attention reason to a REAL catalog event", () => {
    for (const [reason, key] of Object.entries(REASON_TO_EVENT)) {
      expect(
        getNotificationEvent(key),
        `reason "${reason}" maps to "${key}", which is not in the catalog`,
      ).not.toBeNull();
    }
  });

  it("covers every AttentionReason the type allows", () => {
    // If someone adds a fourth reason to AttentionReason, this fails to compile
    // (Record<AttentionReason, string> is exhaustive) — and the count check
    // catches a reason silently dropped from the map at runtime.
    const reasons: AttentionReason[] = ["overdue", "due_soon", "stale"];
    for (const r of reasons) {
      expect(REASON_TO_EVENT[r]).toBeTruthy();
    }
    expect(Object.keys(REASON_TO_EVENT)).toHaveLength(reasons.length);
  });

  it("keeps the mapping in sync with the sweep's own copy", async () => {
    // Read the sweep source and assert the literal it uses matches this one.
    // Two copies of a mapping is normally a smell; here the point is that the
    // test would otherwise just be asserting against the bug.
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "src/lib/notifications/attention-sweep.ts",
      "utf8",
    );
    for (const [reason, key] of Object.entries(REASON_TO_EVENT)) {
      expect(
        src.includes(`${reason}: "${key}"`),
        `attention-sweep.ts does not map ${reason} -> ${key}`,
      ).toBe(true);
    }
  });

  it("bundles all three, so re-running the sweep cannot spam", () => {
    // The sweep has no "last notified" column — bundling IS the dedupe. If any
    // of these were bundle:false, a daily sweep would notify every day forever
    // and an hourly one would be unusable.
    for (const key of Object.values(REASON_TO_EVENT)) {
      expect(getNotificationEvent(key)!.bundle, `${key} must bundle`).toBe(true);
    }
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RecipientCandidate } from "./resolve";
import type { NotificationRow } from "@/lib/db/notifications";

// ── Mocks ────────────────────────────────────────────────────────────────────
// The DB layer is mocked rather than raw Supabase: what is under test here is
// the emitter's ORCHESTRATION (bundle vs insert, when an email is queued), and
// mocking one seam keeps that visible instead of burying it in query builders.

// vi.mock factories are hoisted above every top-level const, so anything they
// close over has to be created inside vi.hoisted().
const h = vi.hoisted(() => ({
  SCHEMA_MISSING: Symbol("notifications-schema-missing"),
  loadFirmRecipients: vi.fn(),
  findBundleTarget: vi.fn(),
  insertNotifications: vi.fn(),
  bumpNotification: vi.fn(),
  // Argument types matter here: vi.fn(async () => ...) infers a zero-arg
  // signature, which makes mock.calls[0][0] a type error at the assertion site.
  // `void` marks them intentionally unread, matching the repo's house style.
  enqueueJob: vi.fn(async (opts: unknown) => {
    void opts;
  }),
  cancelPendingJobs: vi.fn(async (kind: unknown, matcher: unknown) => {
    void kind;
    void matcher;
    return 0;
  }),
}));

const {
  SCHEMA_MISSING,
  loadFirmRecipients,
  findBundleTarget,
  insertNotifications,
  bumpNotification,
  enqueueJob,
  cancelPendingJobs,
} = h;

vi.mock("@/lib/db/notifications", () => ({
  NOTIFICATIONS_SCHEMA_MISSING: h.SCHEMA_MISSING,
  loadFirmRecipients: h.loadFirmRecipients,
  findBundleTarget: h.findBundleTarget,
  insertNotifications: h.insertNotifications,
  bumpNotification: h.bumpNotification,
  isNotificationsSchemaMissing: () => false,
}));

vi.mock("@/lib/db/jobs", () => ({
  enqueueJob: h.enqueueJob,
  cancelPendingJobs: h.cancelPendingJobs,
}));

// firms.timezone + engagements.assigned_user_id lookups.
const state = vi.hoisted(() => ({ assignedUserId: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "firms"
              ? { data: { timezone: "America/Toronto" }, error: null }
              : {
                  data: { assigned_user_id: state.assignedUserId },
                  error: null,
                },
        }),
      }),
    }),
  }),
}));

import { notify, BUNDLE_WINDOW_MS } from "./notify";

const settings = {
  emailEnabled: true,
  scope: "all_firm" as const,
  emailMode: "instant" as const,
  dailyDigestTime: "08:00",
  timezone: "America/Toronto",
  quietHoursEnabled: false,
  quietHoursStart: "20:00",
  quietHoursEnd: "07:00",
  pauseWeekends: false,
  emailDetailLevel: "full" as const,
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

function existingRow(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "existing-1",
    firm_id: "f1",
    user_id: "u1",
    event_key: "document.uploaded",
    entity_type: "engagement",
    entity_id: "e1",
    actor_id: null,
    payload: { count: 3, first_at: "2026-07-27T10:00:00.000Z" },
    read_at: null,
    dismissed_at: null,
    email_sent_at: null,
    created_at: "2026-07-27T10:05:00.000Z",
    ...overrides,
  };
}

const NOW = new Date("2026-07-27T12:00:00.000Z");

// The row findBundleTarget will hand back, shared with the bump mock below so
// the two stay consistent.
let bundleTarget: NotificationRow | null = null;
function setBundleTarget(row: NotificationRow | null): void {
  bundleTarget = row;
  findBundleTarget.mockResolvedValue(row);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.assignedUserId = null;
  setBundleTarget(null);
  insertNotifications.mockImplementation(
    async (_sb: unknown, rows: { user_id: string }[]) =>
      rows.map((r, i) => ({ ...existingRow(), id: `new-${i}`, user_id: r.user_id })),
  );
  // Faithful to production: bumpNotification is an UPDATE ... RETURNING *, so
  // every column it does NOT write (email_sent_at above all) comes back
  // unchanged. A mock that dropped email_sent_at would hide the very bug the
  // "don't re-email a bundled row" test exists to catch.
  bumpNotification.mockImplementation(
    async (
      _sb: unknown,
      opts: { id: string; payload: Record<string, unknown>; at: Date },
    ) => ({
      ...(bundleTarget ?? existingRow()),
      id: opts.id,
      payload: opts.payload,
      created_at: opts.at.toISOString(),
    }),
  );
  loadFirmRecipients.mockResolvedValue([candidate("u1"), candidate("u2")]);
});

describe("notify", () => {
  it("writes one notification per recipient and queues their emails", async () => {
    const res = await notify({
      firmId: "f1",
      eventKey: "document.request_complete", // email defaults ON
      entity: { type: "engagement", id: "e1" },
      payload: { client_name: "Gestion Lavoie" },
      now: NOW,
    });
    expect(res.delivered).toBe(2);
    expect(res.emailsQueued).toBe(2);
    expect(insertNotifications).toHaveBeenCalledTimes(1);
    const rows = insertNotifications.mock.calls[0][1] as { user_id: string }[];
    expect(rows.map((r) => r.user_id)).toEqual(["u1", "u2"]);
  });

  it("does not queue an email for an event whose email default is off", async () => {
    const res = await notify({
      firmId: "f1",
      eventKey: "document.uploaded", // email defaults OFF
      entity: { type: "engagement", id: "e1" },
      now: NOW,
    });
    expect(res.delivered).toBe(2);
    expect(res.emailsQueued).toBe(0);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  // ── Acceptance criterion 2 ────────────────────────────────────────────────
  it("folds a repeat occurrence into the existing unread row instead of inserting", async () => {
    setBundleTarget(existingRow());
    const res = await notify({
      firmId: "f1",
      eventKey: "document.uploaded",
      entity: { type: "engagement", id: "e1" },
      payload: { count: 1 },
      now: NOW,
    });
    expect(res.bundled).toBe(2);
    expect(res.delivered).toBe(0);
    expect(insertNotifications).not.toHaveBeenCalled();
  });

  it("accumulates the count and preserves when the bundle started", async () => {
    setBundleTarget(existingRow({ payload: { count: 3 } }));
    await notify({
      firmId: "f1",
      eventKey: "document.uploaded",
      entity: { type: "engagement", id: "e1" },
      payload: { count: 5 },
      now: NOW,
    });
    const opts = bumpNotification.mock.calls[0][1] as {
      payload: Record<string, unknown>;
      at: Date;
    };
    expect(opts.payload.count).toBe(8);
    // created_at moves forward so it resurfaces; first_at keeps the start.
    expect(opts.payload.first_at).toBe("2026-07-27T10:05:00.000Z");
    expect(opts.at).toEqual(NOW);
  });

  it("only looks back one bundle window", async () => {
    await notify({
      firmId: "f1",
      eventKey: "document.uploaded",
      entity: { type: "engagement", id: "e1" },
      now: NOW,
    });
    const opts = findBundleTarget.mock.calls[0][1] as { since: Date };
    expect(NOW.getTime() - opts.since.getTime()).toBe(BUNDLE_WINDOW_MS);
  });

  it("never bundles an event the catalog marks as independent", async () => {
    setBundleTarget(existingRow());
    const res = await notify({
      firmId: "f1",
      eventKey: "payment.received", // bundle: false — two payments are two facts
      entity: { type: "invoice", id: "i1" },
      now: NOW,
    });
    expect(findBundleTarget).not.toHaveBeenCalled();
    expect(res.delivered).toBe(2);
  });

  it("does not re-email about a bundled row that was already emailed", async () => {
    setBundleTarget(existingRow({
        event_key: "message.client_replied",
        email_sent_at: "2026-07-27T11:00:00.000Z",
      }));
    const res = await notify({
      firmId: "f1",
      eventKey: "message.client_replied", // bundles, email defaults ON
      entity: { type: "engagement", id: "e1" },
      now: NOW,
    });
    expect(res.bundled).toBe(2);
    expect(res.emailsQueued).toBe(0);
  });

  it("collapses a burst to one email by cancelling the pending job first", async () => {
    setBundleTarget(existingRow({ event_key: "message.client_replied", email_sent_at: null }));
    const res = await notify({
      firmId: "f1",
      eventKey: "message.client_replied",
      entity: { type: "engagement", id: "e1" },
      now: NOW,
    });
    expect(cancelPendingJobs).toHaveBeenCalledTimes(2);
    expect(res.emailsQueued).toBe(2);
  });

  it("defers an email queued during quiet hours", async () => {
    loadFirmRecipients.mockResolvedValue([
      candidate("u1", {
        settings: { ...settings, quietHoursEnabled: true },
      }),
    ]);
    // 22:00 Toronto on 2026-07-27.
    await notify({
      firmId: "f1",
      eventKey: "document.request_complete",
      entity: { type: "engagement", id: "e1" },
      now: new Date("2026-07-28T02:00:00.000Z"),
    });
    const job = enqueueJob.mock.calls[0][0] as {
      kind: string;
      runAfter: Date;
      payload: Record<string, unknown>;
    };
    expect(job.kind).toBe("send_notification_email");
    expect(job.payload.mode).toBe("quiet_hours");
    // 07:00 the next morning Toronto = 11:00 UTC in July (EDT).
    expect(job.runAfter.toISOString()).toBe("2026-07-28T11:00:00.000Z");
  });

  // ── Acceptance criterion 5 ────────────────────────────────────────────────
  it("sends a locked event immediately even at 23:00 with email switched off", async () => {
    loadFirmRecipients.mockResolvedValue([
      candidate("owner", {
        role: "owner",
        settings: {
          ...settings,
          emailEnabled: false,
          quietHoursEnabled: true,
          emailMode: "daily_digest",
        },
      }),
    ]);
    const at = new Date("2026-07-28T03:00:00.000Z"); // 23:00 Toronto
    const res = await notify({
      firmId: "f1",
      eventKey: "billing.payment_failed",
      now: at,
    });
    expect(res.emailsQueued).toBe(1);
    const job = enqueueJob.mock.calls[0][0] as { runAfter: Date };
    expect(job.runAfter).toEqual(at);
  });

  it("respects assigned_only against the engagement's real assignee", async () => {
    state.assignedUserId = "u2";
    loadFirmRecipients.mockResolvedValue([
      candidate("u1", { settings: { ...settings, scope: "assigned_only" } }),
      candidate("u2", { settings: { ...settings, scope: "assigned_only" } }),
    ]);
    const res = await notify({
      firmId: "f1",
      eventKey: "document.uploaded",
      entity: { type: "engagement", id: "e1" },
      now: NOW,
    });
    expect(res.delivered).toBe(1);
    const rows = insertNotifications.mock.calls[0][1] as { user_id: string }[];
    expect(rows.map((r) => r.user_id)).toEqual(["u2"]);
  });

  it("honours an explicit recipient override", async () => {
    const res = await notify({
      firmId: "f1",
      eventKey: "document.request_complete",
      entity: { type: "engagement", id: "e1" },
      recipients: ["u2"],
      now: NOW,
    });
    expect(res.delivered).toBe(1);
    const rows = insertNotifications.mock.calls[0][1] as { user_id: string }[];
    expect(rows.map((r) => r.user_id)).toEqual(["u2"]);
  });

  // ── The two invariants ────────────────────────────────────────────────────
  it("no-ops instead of throwing when the migration is not applied yet", async () => {
    loadFirmRecipients.mockResolvedValue(SCHEMA_MISSING);
    const res = await notify({
      firmId: "f1",
      eventKey: "document.uploaded",
      now: NOW,
    });
    expect(res.skipped).toBe("schema_missing");
    expect(res.delivered).toBe(0);
  });

  it("never throws, whatever the data layer does", async () => {
    loadFirmRecipients.mockRejectedValue(new Error("database on fire"));
    await expect(
      notify({ firmId: "f1", eventKey: "document.uploaded", now: NOW }),
    ).resolves.toEqual({ delivered: 0, bundled: 0, emailsQueued: 0 });
  });

  it("logs and skips an unknown event key rather than writing a bad row", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await notify({
      firmId: "f1",
      eventKey: "typo.in_a_call_site",
      now: NOW,
    });
    expect(res.skipped).toBe("unknown_event");
    expect(insertNotifications).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a failure to queue the email still keeps the in-app notification", async () => {
    enqueueJob.mockRejectedValueOnce(new Error("queue down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await notify({
      firmId: "f1",
      eventKey: "document.request_complete",
      entity: { type: "engagement", id: "e1" },
      now: NOW,
    });
    expect(res.delivered).toBe(2);
    expect(res.emailsQueued).toBe(1); // the second one still went through
    spy.mockRestore();
  });
});

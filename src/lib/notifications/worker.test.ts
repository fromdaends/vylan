import { describe, it, expect, vi, beforeEach } from "vitest";

// The digest sweep had NO test file at all, which is how a duplicate-send race
// and two missing filters all shipped past a green suite. These tests drive the
// worker against a hand-rolled Supabase double that models the one property
// that matters: an UPDATE with an `is("email_sent_at", null)` predicate only
// affects rows that are still unclaimed.

const h = vi.hoisted(() => ({
  sendEmail: vi.fn(async (args: unknown) => {
    void args;
    return { sent: true as const, id: "e1" };
  }),
  rows: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/email", () => ({
  sendEmail: h.sendEmail,
  escapeHtml: (s: string) => s,
}));

// A tiny query builder covering exactly the shapes worker.ts uses.
function makeClient() {
  return {
    from(table: string) {
      const state: {
        op: "select" | "update";
        patch?: Record<string, unknown>;
        filters: { col: string; val: unknown; kind: "eq" | "is" | "in" }[];
      } = { op: "select", filters: [] };

      const match = (r: Record<string, unknown>) =>
        state.filters.every((f) => {
          if (f.kind === "in") return (f.val as string[]).includes(r[f.col] as string);
          return r[f.col] === f.val;
        });

      const api: Record<string, unknown> = {
        select: () => api,
        update: (patch: Record<string, unknown>) => {
          state.op = "update";
          state.patch = patch;
          return api;
        },
        eq: (col: string, val: unknown) => {
          // worker filters on payload->>email_queued
          if (col === "payload->>email_queued") {
            state.filters.push({
              col: "__email_queued",
              val: val === "true",
              kind: "eq",
            });
          } else {
            state.filters.push({ col, val, kind: "eq" });
          }
          return api;
        },
        is: (col: string, val: unknown) => {
          state.filters.push({ col, val, kind: "is" });
          return api;
        },
        in: (col: string, val: unknown) => {
          state.filters.push({ col, val: val as string[], kind: "in" });
          return api;
        },
        order: () => api,
        limit: () => api,
        maybeSingle: async () => {
          if (table === "users") {
            return {
              data: {
                email: "acct@firm.test",
                name: "Marie",
                display_name: null,
                locale: "en",
                deactivated_at: null,
              },
              error: null,
            };
          }
          if (table === "notification_settings") {
            return { data: { email_enabled: true, email_detail_level: "full" }, error: null };
          }
          const hit = h.rows.filter(match)[0] ?? null;
          return { data: hit, error: null };
        },
        then(resolve: (v: unknown) => void) {
          const hits = h.rows.filter((r) => {
            const withFlag: Record<string, unknown> = {
              ...r,
              __email_queued:
                (r.payload as Record<string, unknown>)?.email_queued === true,
            };
            return state.filters.every((f) => {
              if (f.kind === "in")
                return (f.val as string[]).includes(withFlag[f.col] as string);
              return withFlag[f.col] === f.val;
            });
          });
          if (state.op === "update") {
            for (const r of hits) Object.assign(r, state.patch);
          }
          resolve({ data: hits.map((r) => ({ ...r })), error: null });
        },
      };
      return api;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => makeClient(),
}));

import { processSendNotificationEmailJob } from "./worker";

function notification(over: Record<string, unknown> = {}) {
  return {
    id: "n1",
    firm_id: "f1",
    user_id: "u1",
    event_key: "document.request_complete",
    entity_type: "engagement",
    entity_id: "e1",
    actor_id: null,
    payload: { client_name: "Gestion Lavoie", email_queued: true, in_app: true },
    read_at: null,
    dismissed_at: null,
    email_sent_at: null,
    created_at: "2026-07-27T12:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [];
});

describe("single notification email", () => {
  it("sends once and stamps the row", async () => {
    h.rows = [notification()];
    const res = await processSendNotificationEmailJob({
      notification_id: "n1",
      mode: "instant",
    });
    expect(res.sent).toBe(true);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.rows[0].email_sent_at).toBeTruthy();
  });

  it("skips a row the user already read in the app", async () => {
    h.rows = [notification({ read_at: "2026-07-27T12:30:00.000Z" })];
    const res = await processSendNotificationEmailJob({ notification_id: "n1" });
    expect(res.skipped).toBe("already_read_in_app");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("skips a row the user deleted", async () => {
    h.rows = [notification({ dismissed_at: "2026-07-27T12:30:00.000Z" })];
    const res = await processSendNotificationEmailJob({ notification_id: "n1" });
    expect(res.skipped).toBe("dismissed");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("is idempotent — a retry after a successful send does nothing", async () => {
    h.rows = [notification()];
    await processSendNotificationEmailJob({ notification_id: "n1" });
    const again = await processSendNotificationEmailJob({ notification_id: "n1" });
    expect(again.skipped).toBe("already_sent");
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("digest", () => {
  // ── The critical race ─────────────────────────────────────────────────────
  it("two concurrent digest jobs for one user send exactly ONE email", async () => {
    // Every notification raised in one digest window gets an IDENTICAL
    // run_after, so the cron claims several of this user's jobs in one wave and
    // runs them with Promise.all. Read-then-send-then-stamp meant each job
    // passed the already-sent guard and sent its own full copy.
    h.rows = [notification({ id: "n1" }), notification({ id: "n2" })];
    const [a, b] = await Promise.all([
      processSendNotificationEmailJob({
        notification_id: "n1",
        mode: "hourly_digest",
      }),
      processSendNotificationEmailJob({
        notification_id: "n2",
        mode: "hourly_digest",
      }),
    ]);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.sent).length).toBe(1);
    expect(
      outcomes.filter((r) => r.skipped === "claimed_by_another_job").length,
    ).toBe(1);
    // Every row is accounted for — neither is left to be emailed again.
    expect(h.rows.every((r) => r.email_sent_at)).toBe(true);
  });

  it("rolls the claim back when the send fails, so a retry can resend", async () => {
    h.rows = [notification()];
    h.sendEmail.mockResolvedValueOnce({ sent: false, reason: "smtp down" } as never);
    await expect(
      processSendNotificationEmailJob({
        notification_id: "n1",
        mode: "daily_digest",
      }),
    ).rejects.toThrow(/digest email failed/);
    // Not left stamped — otherwise a transient blip would swallow the digest.
    expect(h.rows[0].email_sent_at).toBeNull();
  });

  // ── The two missing filters ───────────────────────────────────────────────
  it("excludes rows whose event had email switched off", async () => {
    h.rows = [
      notification({ id: "n1" }),
      notification({
        id: "n2",
        payload: { email_queued: false, in_app: true },
      }),
    ];
    await processSendNotificationEmailJob({
      notification_id: "n1",
      mode: "daily_digest",
    });
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    // The opted-out row is untouched and is NOT in the email.
    expect(h.rows[1].email_sent_at).toBeNull();
    const sent = h.sendEmail.mock.calls[0][0] as { html: string };
    expect(sent.html).toContain("(1)");
  });

  it("excludes suppressEmail rows, so the legacy job's email is not duplicated", async () => {
    // engagement.assigned_to_you and message.client_replied keep their own
    // smarter email jobs; the emitter marks their rows email_queued:false. A
    // digest that swept them up would email the same person twice.
    h.rows = [
      notification({
        id: "n1",
        event_key: "engagement.assigned_to_you",
        payload: { email_queued: false, in_app: true },
      }),
    ];
    const res = await processSendNotificationEmailJob({
      notification_id: "n1",
      mode: "hourly_digest",
    });
    expect(res.skipped).toBe("nothing_to_digest");
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

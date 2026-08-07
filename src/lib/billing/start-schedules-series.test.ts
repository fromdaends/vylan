import { beforeEach, describe, expect, it, vi } from "vitest";

// ONE PAYMENT SCHEDULE PER SERIES.
//
// The founder's arrangement: an annual T2 whose fee is paid monthly. The work
// repeats yearly (a fresh engagement each year), the money is ONE continuous
// monthly schedule. Because engagement_billing_schedules is unique on
// (engagement_id, frequency), each spawned occurrence would otherwise open its
// own monthly schedule while last year's kept running — $300/mo silently
// becoming $600/mo. That stacking is the only reason the two cadences were
// ever mutually exclusive, so this is the test that lets them coexist.

const createSchedule = vi.fn();

// The world: one series, one sibling occurrence, and whatever schedules that
// sibling currently has.
let seriesId: string | null = "series-1";
let siblingIds: string[] = ["e-2025"];
let siblingSchedules: Array<{ frequency: string; status: string }> = [];
let seriesReadFails = false;
// A transient read failure (not a missing column) on the schedules lookup.
let scheduleReadErrors = false;

const serviceRole = {
  from(table: string) {
    return {
      select(cols?: string) {
        const builder = {
          eq: () => builder,
          neq: () => builder,
          in: () => builder,
          order: () => builder,
          // engagement_items list read, and the schedules list read.
          then(resolve: (v: { data: unknown[]; error: unknown }) => unknown) {
            if (table === "engagement_billing_schedules" && scheduleReadErrors) {
              return Promise.resolve({
                data: null,
                error: { code: "57014", message: "statement timeout" },
              }).then(resolve as never);
            }
            const data =
              table === "engagement_billing_schedules"
                ? siblingSchedules
                : table === "engagements"
                  ? siblingIds.map((id) => ({ id }))
                  : table === "engagement_items"
                    ? [
                        {
                          name: "Corporate return",
                          rate_cents: 360_000,
                          rate_type: "item",
                          billing_frequency: "monthly",
                        },
                      ]
                    : [];
            return Promise.resolve({ data, error: null }).then(resolve);
          },
          async maybeSingle() {
            if (table !== "engagements") return { data: null, error: null };
            // The series lookup asks for series_id specifically.
            if (cols?.includes("series_id")) {
              if (seriesReadFails) {
                return { data: null, error: { code: "42703", message: "column does not exist" } };
              }
              return { data: { series_id: seriesId }, error: null };
            }
            if (cols?.includes("start_date")) {
              return { data: { start_date: null }, error: null };
            }
            return {
              data: {
                id: "e-2026",
                firm_id: "f1",
                client_id: "c1",
                title: "Corporate return — 2026",
              },
              error: null,
            };
          },
        };
        return builder;
      },
    };
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => serviceRole,
}));
vi.mock("@/lib/db/billing-schedules", () => ({
  createBillingScheduleSR: (input: unknown) => createSchedule(input),
}));

const { startRecurringSchedules } = await import("./start-schedules");

beforeEach(() => {
  createSchedule.mockReset();
  createSchedule.mockResolvedValue({ id: "sched-new" });
  seriesId = "series-1";
  siblingIds = ["e-2025"];
  siblingSchedules = [];
  seriesReadFails = false;
  scheduleReadErrors = false;
});

describe("startRecurringSchedules — a series bills once, not once per year", () => {
  it("does NOT open a second monthly schedule when a sibling already bills monthly", async () => {
    siblingSchedules = [{ frequency: "monthly", status: "active" }];
    const out = await startRecurringSchedules("e-2026", "2026-08-07");
    expect(createSchedule).not.toHaveBeenCalled();
    expect(out.started).toEqual([]);
    expect(out.existing).toEqual(["monthly"]);
  });

  it("starts the schedule on the FIRST occurrence, when nothing bills yet", async () => {
    siblingSchedules = [];
    const out = await startRecurringSchedules("e-2026", "2026-08-07");
    expect(createSchedule).toHaveBeenCalledTimes(1);
    expect(out.started).toEqual(["monthly"]);
  });

  it("a sibling billing a DIFFERENT cadence doesn't block this one", async () => {
    siblingSchedules = [{ frequency: "yearly", status: "active" }];
    const out = await startRecurringSchedules("e-2026", "2026-08-07");
    expect(createSchedule).toHaveBeenCalledTimes(1);
    expect(out.started).toEqual(["monthly"]);
  });

  it("a standalone engagement (no series) is unaffected", async () => {
    seriesId = null;
    siblingSchedules = [{ frequency: "monthly", status: "active" }];
    const out = await startRecurringSchedules("e-solo", "2026-08-07");
    expect(createSchedule).toHaveBeenCalledTimes(1);
    expect(out.started).toEqual(["monthly"]);
  });

  it("an ENDED sibling schedule doesn't block a restart", async () => {
    // The query filters status != 'ended', so an ended one never comes back;
    // the arrangement really is over and a new one may begin.
    siblingSchedules = [];
    const out = await startRecurringSchedules("e-2026", "2026-08-07");
    expect(out.started).toEqual(["monthly"]);
  });

  it("pre-0770 (no series_id column) falls through to the old behaviour", async () => {
    seriesReadFails = true;
    siblingSchedules = [{ frequency: "monthly", status: "active" }];
    const out = await startRecurringSchedules("e-2026", "2026-08-07");
    expect(createSchedule).toHaveBeenCalledTimes(1);
    expect(out.started).toEqual(["monthly"]);
  });
});

describe("the two ways a duplicate schedule used to slip through", () => {
  it("a PAUSED sibling still counts — un-archiving a client resumes every paused schedule", async () => {
    // The billing cron pauses a schedule while its client is archived. If
    // paused read as "nothing is billing", this occurrence would open a
    // second one — and un-archiving switches BOTH on, forever.
    siblingSchedules = [{ frequency: "monthly", status: "paused" }];
    const out = await startRecurringSchedules("e-2026", "2026-08-07");
    expect(createSchedule).not.toHaveBeenCalled();
    expect(out.existing).toEqual(["monthly"]);
  });

  it("a read it cannot complete fails CLOSED, never into a second charge", async () => {
    scheduleReadErrors = true;
    const out = await startRecurringSchedules("e-2026", "2026-08-07");
    expect(createSchedule).not.toHaveBeenCalled();
    expect(out.existing).toEqual(["monthly"]);
  });
});

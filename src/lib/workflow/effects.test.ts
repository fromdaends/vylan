import { describe, it, expect, vi, beforeEach } from "vitest";

// The effects runner's promise is EXACTLY-ONCE per (engagement, stage,
// action), enforced by the ledger's unique index. These tests stand in a fake
// database that honours that index and prove: a second sync fires nothing, a
// regressed-and-recovered stage fires nothing, and the invoice/task/assign
// side effects each ran exactly once.

const inserted: Record<string, unknown[]> = {};
const ledgerKeys = new Set<string>();
const updates: { table: string; values: Record<string, unknown> }[] = [];

function reset() {
  for (const k of Object.keys(inserted)) delete inserted[k];
  ledgerKeys.clear();
  updates.length = 0;
}

// A minimal chainable, awaitable stand-in for the supabase client — just the
// calls effects.ts actually makes, with the ledger's unique index simulated.
function fakeSb() {
  function table(name: string) {
    const chain = {
      _op: "select" as "select" | "insert" | "update",
      _rows: [] as unknown[],
      insert(rows: unknown) {
        chain._op = "insert";
        chain._rows = Array.isArray(rows) ? rows : [rows];
        if (name === "workflow_stage_events") {
          const r = chain._rows[0] as {
            engagement_id: string;
            stage: string;
            action: string;
          };
          const key = `${r.engagement_id}|${r.stage}|${r.action}`;
          if (ledgerKeys.has(key)) {
            return {
              ...chain,
              then: (res: (v: unknown) => void) =>
                res({ error: { code: "23505" } }),
              select: () => ({ error: { code: "23505" }, data: null }),
            };
          }
          ledgerKeys.add(key);
        }
        (inserted[name] ??= []).push(...chain._rows);
        return chain;
      },
      update(values: Record<string, unknown>) {
        chain._op = "update";
        updates.push({ table: name, values });
        return chain;
      },
      select() {
        if (chain._op === "insert") {
          // .insert(rows).select("id") — hand back ids for the task rows.
          return Promise.resolve({
            data: chain._rows.map((_, i) => ({ id: `task-${i}` })),
            error: null,
          });
        }
        return chain;
      },
      eq: () => chain,
      not: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle() {
        const data: Record<string, Record<string, unknown> | null> = {
          users: { id: "staff-1", firm_id: "firm-1", deactivated_at: null },
          engagements: {
            assigned_user_id: null,
            title: "T1 2025",
            client_id: "client-1",
          },
          firms: { notify_on_assignment: false },
          clients: { locale: "en" },
          engagement_tasks: null, // no existing rows → order_index starts at 0
        };
        return Promise.resolve({ data: data[name] ?? null, error: null });
      },
      then(resolve: (v: unknown) => void) {
        resolve({ data: null, error: null });
      },
    };
    return chain;
  }
  return { from: table };
}

vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => fakeSb(),
}));
const logActivity = vi.fn<(...args: unknown[]) => Promise<void>>(
  async () => {},
);
vi.mock("@/lib/db/activity", () => ({
  logServiceRoleActivity: (...args: unknown[]) => logActivity(...args),
}));
const notifyFn = vi.fn<(...args: unknown[]) => Promise<object>>(
  async () => ({}),
);
vi.mock("@/lib/notifications/notify", () => ({
  notify: (...args: unknown[]) => notifyFn(...args),
}));
vi.mock("@/lib/notifications/emit", () => ({
  clientName: async () => "Client",
  userName: async () => "Someone",
}));
vi.mock("@/lib/db/jobs", () => ({
  enqueueJob: vi.fn(async () => {}),
  cancelPendingJobs: vi.fn(async () => {}),
}));
vi.mock("@/lib/team/assignment-notify", () => ({
  ASSIGNMENT_EMAIL_DELAY_MS: 0,
}));
const sendInvoice = vi.fn<(...args: unknown[]) => Promise<{ ok: true }>>(
  async () => ({ ok: true }),
);
vi.mock("@/lib/invoices/send", () => ({
  sendEngagementInvoice: (...args: unknown[]) => sendInvoice(...args),
}));

import { runWorkflowStageEffects } from "./effects";
import { buildWorkflowSnapshot, bookkeepingWorkflow } from "./definition";

const wf = buildWorkflowSnapshot(bookkeepingWorkflow(), {
  ownerId: "owner-1",
  staffId: "staff-1",
  activeMemberIds: new Set(["owner-1", "staff-1"]),
  fallbackId: "owner-1",
});

const base = {
  engagementId: "eng-1",
  firmId: "firm-1",
  clientId: "client-1",
  wf,
};

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});

describe("runWorkflowStageEffects — exactly once", () => {
  it("fires collecting's entry once and never again, whatever re-syncs", async () => {
    const first = await runWorkflowStageEffects({
      ...base,
      prev: null,
      next: "collecting",
    });
    // Ledger got the entry + the checklist action; the engagement was handed
    // to staff-1 and they were pinged in-app.
    expect(ledgerKeys.has("eng-1|collecting|entered")).toBe(true);
    expect(ledgerKeys.has("eng-1|collecting|activate_checklist")).toBe(true);
    expect(notifyFn).toHaveBeenCalledTimes(1);
    expect(first.factsChanged).toBe(false);

    // Replay — a duplicate webhook, a concurrent sync, anything.
    const again = await runWorkflowStageEffects({
      ...base,
      prev: null,
      next: "collecting",
    });
    expect(again.factsChanged).toBe(false);
    expect(notifyFn).toHaveBeenCalledTimes(1); // still once
  });

  it("materializes stage tasks once, tagged with their stage", async () => {
    await runWorkflowStageEffects({ ...base, prev: null, next: "collecting" });
    await runWorkflowStageEffects({
      ...base,
      prev: "collecting",
      next: "in_preparation",
    });
    const tasks = (inserted["engagement_tasks"] ?? []) as {
      title: string;
      workflow_stage: string;
      kind: string;
    }[];
    expect(tasks).toHaveLength(2); // bookkeeping's two prep tasks
    expect(tasks.every((t) => t.workflow_stage === "in_preparation")).toBe(true);
    expect(tasks.every((t) => t.kind === "task")).toBe(true);
    // Client locale is en in the fake — English titles.
    expect(tasks[0].title).toBe("Reconcile bank and credit card accounts");

    // Re-entering the stage later (facts regressed and recovered) creates
    // nothing new.
    await runWorkflowStageEffects({
      ...base,
      prev: "collecting",
      next: "in_preparation",
    });
    expect(inserted["engagement_tasks"]).toHaveLength(2);
  });

  it("sends the invoice exactly once on awaiting_payment and reports facts changed", async () => {
    const res = await runWorkflowStageEffects({
      ...base,
      prev: "in_preparation",
      next: "awaiting_payment",
    });
    expect(sendInvoice).toHaveBeenCalledTimes(1);
    expect(sendInvoice).toHaveBeenCalledWith("eng-1", { atStage: true });
    expect(res.factsChanged).toBe(true);

    const replay = await runWorkflowStageEffects({
      ...base,
      prev: "in_preparation",
      next: "awaiting_payment",
    });
    expect(sendInvoice).toHaveBeenCalledTimes(1);
    expect(replay.factsChanged).toBe(false);
  });

  it("records the skip-jump on the landing stage's audit entry", async () => {
    await runWorkflowStageEffects({
      ...base,
      prev: "in_preparation",
      next: "awaiting_payment",
    });
    const entries = logActivity.mock.calls.filter(
      (c) => c[2] === "workflow_stage_entered",
    );
    const landing = entries.find(
      (c) => (c[3] as { stage: string }).stage === "awaiting_payment",
    );
    // Bookkeeping skips awaiting_signature; the jump is on the record.
    expect((landing?.[3] as { skipped?: string[] }).skipped).toEqual([
      "awaiting_signature",
    ]);
  });
});

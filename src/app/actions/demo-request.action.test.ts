// Walk a row through saveDemoStep 1 → 2 → 3 and verify:
//   - Step 1 creates a row, returns its id
//   - Steps 2 + 3 update by id, bumping furthest_step
//   - Founder notifications fire on step 1 + step 3 (not step 2)
//   - A partial fill (step 1 only) still persists the email

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DemoRequest } from "@/lib/db/demo-requests";

// In-memory fake DB that the action layer talks to.
const fakeStore = new Map<string, DemoRequest>();

vi.mock("@/lib/db/demo-requests", () => {
  return {
    createDemoRequest: async (input: {
      contact_name: string;
      email: string;
      firm_name: string;
    }) => {
      const id = `row-${fakeStore.size + 1}`;
      const now = new Date().toISOString();
      const row: DemoRequest = {
        id,
        contact_name: input.contact_name,
        email: input.email,
        firm_name: input.firm_name,
        firm_size: null,
        client_volume: null,
        current_tool: null,
        current_tool_other: null,
        phone: null,
        province: null,
        preferred_language: null,
        marketing_opt_in: false,
        furthest_step: 1,
        booked_at: null,
        notified_at: null,
        notion_page_id: null,
        created_at: now,
        updated_at: now,
      };
      fakeStore.set(id, row);
      return row;
    },
    updateDemoRequest: async (
      id: string,
      patch: Partial<DemoRequest>,
    ) => {
      const existing = fakeStore.get(id);
      if (!existing) return null;
      const next = {
        ...existing,
        ...patch,
        updated_at: new Date().toISOString(),
      } as DemoRequest;
      fakeStore.set(id, next);
      return next;
    },
    getDemoRequest: async (id: string) => fakeStore.get(id) ?? null,
  };
});

// Never hit the real rate limiter.
vi.mock("@/lib/rate-limit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/rate-limit")>(
      "@/lib/rate-limit",
    );
  return {
    ...actual,
    checkRateLimit: async () => ({ ok: true as const }),
    ipFromRequest: () => "test-ip",
  };
});

// Stub next/headers so the action can be called outside a request.
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: () => null,
  }),
}));

// next/server's `after` requires a real request scope at runtime.
// In tests we just run the callback synchronously — it stands in
// for the post-response continuation.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (fn: () => unknown | Promise<unknown>) => {
      void Promise.resolve().then(() => fn());
    },
  };
});

const qualifiedMock = vi.fn(async (_row: DemoRequest) => ({ id: "stub" }));
const bookedMock = vi.fn(async (_row: DemoRequest) => ({ id: "stub" }));

vi.mock("@/lib/demo-notify", () => ({
  // Step 1 and Step 2 submissions don't fire emails — the cron
  // (/api/cron/demo-leads) picks those up 5 min after last activity
  // via notifyFounderLead. Step 3 + booking fire immediately.
  notifyFounderLead: () => undefined,
  notifyFounderPartialLead: () => undefined,
  notifyFounderQualifiedLead: (r: DemoRequest) => qualifiedMock(r),
  notifyFounderDemoBooked: (r: DemoRequest) => bookedMock(r),
}));

// Notion push is best-effort; tests don't care about it, so stub it
// out entirely. (Real behaviour: if env vars unset it silently no-ops.)
vi.mock("@/lib/notion", () => ({
  pushLeadToNotion: () => Promise.resolve(),
}));

import { saveDemoStep, markDemoBooked } from "./demo-request";

describe("saveDemoStep — funnel walk", () => {
  beforeEach(() => {
    fakeStore.clear();
    qualifiedMock.mockClear();
    bookedMock.mockClear();
  });

  it("step 1 creates a row, returns id, does NOT fire an email", async () => {
    const res = await saveDemoStep({
      step: 1,
      data: {
        contact_name: "Phil Jette",
        email: "phil@vylan.app",
        firm_name: "Acme CPA",
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const row = fakeStore.get(res.id);
      expect(row?.email).toBe("phil@vylan.app");
      expect(row?.furthest_step).toBe(1);
      // Debounced now — cron sends the email, not the action.
      expect(row?.notified_at).toBeFalsy();
    }
  });

  it("step 1 (partial fill) persists the email even if user bails", async () => {
    const res = await saveDemoStep({
      step: 1,
      data: {
        contact_name: "Bailing Bob",
        email: "bob@example.com",
        firm_name: "Bob's Books",
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Founder can still see them in the DB.
    expect([...fakeStore.values()][0]?.email).toBe("bob@example.com");
  });

  it("walks all 3 steps, updates same row, ends at furthest_step=3", async () => {
    const r1 = await saveDemoStep({
      step: 1,
      data: {
        contact_name: "Phil Jette",
        email: "phil@vylan.app",
        firm_name: "Acme CPA",
      },
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const id = r1.id;

    const r2 = await saveDemoStep({
      step: 2,
      existingId: id,
      data: {
        firm_size: "2_5",
        client_volume: "25_100",
        current_tool: "taxdome",
      },
    });
    expect(r2.ok).toBe(true);
    expect(fakeStore.get(id)?.furthest_step).toBe(2);
    expect(fakeStore.get(id)?.firm_size).toBe("2_5");
    expect(fakeStore.get(id)?.current_tool).toBe("taxdome");

    const r3 = await saveDemoStep({
      step: 3,
      existingId: id,
      data: {
        phone: "+1 514 555 0100",
        province: "QC",
        preferred_language: "fr",
        marketing_opt_in: true,
      },
    });
    expect(r3.ok).toBe(true);
    expect(fakeStore.get(id)?.furthest_step).toBe(3);
    expect(fakeStore.get(id)?.marketing_opt_in).toBe(true);
    expect(fakeStore.get(id)?.province).toBe("QC");
    // Step 3 fires the qualified email immediately + stamps
    // notified_at so the cron doesn't re-send.
    expect(fakeStore.get(id)?.notified_at).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(qualifiedMock).toHaveBeenCalledTimes(1);
  });

  it("step 2 with current_tool=other_software requires the free-text field", async () => {
    const r1 = await saveDemoStep({
      step: 1,
      data: {
        contact_name: "Phil",
        email: "phil@vylan.app",
        firm_name: "Acme",
      },
    });
    if (!r1.ok) throw new Error("setup");

    const bad = await saveDemoStep({
      step: 2,
      existingId: r1.id,
      data: {
        firm_size: "solo",
        client_volume: "under_25",
        current_tool: "other_software",
      },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toBe("tool_name_required");
    }

    const good = await saveDemoStep({
      step: 2,
      existingId: r1.id,
      data: {
        firm_size: "solo",
        client_volume: "under_25",
        current_tool: "other_software",
        current_tool_other: "Citrix ShareFile",
      },
    });
    expect(good.ok).toBe(true);
    expect(fakeStore.get(r1.id)?.current_tool_other).toBe("Citrix ShareFile");
  });

  it("step 2 with a stale id returns not_found instead of silently inserting", async () => {
    const res = await saveDemoStep({
      step: 2,
      existingId: "nope",
      data: {
        firm_size: "solo",
        client_volume: "under_25",
        current_tool: "nothing",
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("not_found");
  });

  it("step 3 missing existingId returns missing_id (no orphaned row)", async () => {
    // @ts-expect-error — deliberately testing the missing existingId branch
    const res = await saveDemoStep({ step: 3, data: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("missing_id");
  });
});

describe("markDemoBooked", () => {
  beforeEach(() => {
    fakeStore.clear();
    bookedMock.mockClear();
  });

  it("stamps booked_at + notified_at and fires the booked notification", async () => {
    const r1 = await saveDemoStep({
      step: 1,
      data: {
        contact_name: "Phil",
        email: "phil@vylan.app",
        firm_name: "Acme",
      },
    });
    if (!r1.ok) throw new Error("setup");

    const res = await markDemoBooked(r1.id);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.row.booked_at).toBeTruthy();
      // notified_at also gets set so the debounce cron won't fire
      // a redundant qualified-lead email for this fast-booking lead.
      expect(res.row.notified_at).toBeTruthy();
    }

    await new Promise((r) => setTimeout(r, 0));
    expect(bookedMock).toHaveBeenCalledTimes(1);
  });

  it("rejects empty id", async () => {
    const res = await markDemoBooked("");
    expect(res.ok).toBe(false);
  });
});

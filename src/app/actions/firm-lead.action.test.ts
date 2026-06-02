// submitFirmLead — the landing marketing-site lead form action. Writes
// to the shared demo_requests table via createFirmLead, then fires the
// founder notification through after(). Self-contained mocks so it
// doesn't share state with the saveDemoStep funnel test.

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DemoRequest } from "@/lib/db/demo-requests";

const store = new Map<string, DemoRequest>();
const createFirmLeadSpy = vi.fn();

vi.mock("@/lib/db/demo-requests", () => ({
  createFirmLead: async (input: {
    email: string;
    firm_name: string;
    practice_type: string;
    active_clients: string;
    notes: string | null;
  }) => {
    createFirmLeadSpy(input);
    const id = `lead-${store.size + 1}`;
    const now = new Date().toISOString();
    const row: DemoRequest = {
      id,
      contact_name: null,
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
      furthest_step: 3,
      booked_at: null,
      notified_at: now,
      notion_page_id: null,
      practice_type: input.practice_type,
      active_clients: input.active_clients,
      notes: input.notes,
      source: "landing_form",
      created_at: now,
      updated_at: now,
    };
    store.set(id, row);
    return row;
  },
}));

let rateOk = true;
vi.mock("@/lib/rate-limit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/rate-limit")>(
      "@/lib/rate-limit",
    );
  return {
    ...actual,
    checkRateLimit: async () =>
      rateOk ? { ok: true as const } : { ok: false as const },
    ipFromRequest: () => "test-ip",
  };
});

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

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

const firmLeadNotifySpy = vi.fn(async (_row: DemoRequest) => ({ sent: true }));
vi.mock("@/lib/demo-notify", () => ({
  notifyFounderFirmLead: (r: DemoRequest) => firmLeadNotifySpy(r),
}));
vi.mock("@/lib/notion", () => ({
  pushLeadToNotion: () => Promise.resolve(),
}));

import { submitFirmLead } from "./demo-request";

describe("submitFirmLead", () => {
  beforeEach(() => {
    store.clear();
    createFirmLeadSpy.mockClear();
    firmLeadNotifySpy.mockClear();
    rateOk = true;
  });

  it("saves a lead with the landing fields + source and returns the id", async () => {
    const res = await submitFirmLead({
      email: "phil@vylan.app",
      firm_name: "Acme CPA",
      practice_type: "tax_advisory",
      active_clients: "100_500",
      notes: "Chasing T4s by hand every February.",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = store.get(res.id);
    expect(row?.email).toBe("phil@vylan.app");
    expect(row?.source).toBe("landing_form");
    expect(row?.practice_type).toBe("tax_advisory");
    expect(row?.active_clients).toBe("100_500");
    expect(row?.notes).toContain("T4s");
    // Single submit = complete lead, pre-notified so the debounce cron
    // never double-emails it.
    expect(row?.furthest_step).toBe(3);
    expect(row?.notified_at).toBeTruthy();
  });

  it("fires the founder notification via after()", async () => {
    await submitFirmLead({
      email: "a@b.com",
      firm_name: "B Co",
      practice_type: "solo",
      active_clients: "under_25",
      notes: "",
    });
    // let the after() microtask run
    await new Promise((r) => setTimeout(r, 0));
    expect(firmLeadNotifySpy).toHaveBeenCalledTimes(1);
  });

  it("normalises a blank note to null", async () => {
    const res = await submitFirmLead({
      email: "a@b.com",
      firm_name: "B Co",
      practice_type: "solo",
      active_clients: "under_25",
      notes: "   ",
    });
    expect(res.ok).toBe(true);
    expect(createFirmLeadSpy).toHaveBeenCalledWith(
      expect.objectContaining({ notes: null }),
    );
  });

  it("rejects an invalid email without saving", async () => {
    const res = await submitFirmLead({
      email: "not-an-email",
      firm_name: "B Co",
      practice_type: "solo",
      active_clients: "under_25",
      notes: "",
    });
    expect(res.ok).toBe(false);
    expect(createFirmLeadSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown practice_type enum value", async () => {
    const res = await submitFirmLead({
      email: "a@b.com",
      firm_name: "B Co",
      practice_type: "huge_firm",
      active_clients: "under_25",
      notes: "",
    });
    expect(res.ok).toBe(false);
    expect(createFirmLeadSpy).not.toHaveBeenCalled();
  });

  it("returns rate_limited when the limiter rejects", async () => {
    rateOk = false;
    const res = await submitFirmLead({
      email: "a@b.com",
      firm_name: "B Co",
      practice_type: "solo",
      active_clients: "under_25",
      notes: "",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("rate_limited");
    expect(createFirmLeadSpy).not.toHaveBeenCalled();
  });
});

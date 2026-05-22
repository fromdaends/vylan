// Tests for the Notion lead-sync helper. We don't hit the real
// Notion API — we stub global fetch and assert what we'd send.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { DemoRequest } from "@/lib/db/demo-requests";

const updateMock = vi.fn(async (_patch?: Record<string, unknown>) => ({
  error: null,
}));
const eqMock = vi.fn(() => updateMock());

vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updateMock(patch);
        return { eq: eqMock };
      },
    }),
  }),
}));

import { pushLeadToNotion } from "./notion";

function fakeRow(extra: Partial<DemoRequest> = {}): DemoRequest {
  return {
    id: "lead-abc",
    contact_name: "Phil Jette",
    email: "phil@vylan.app",
    firm_name: "Acme CPA",
    firm_size: "2_5",
    client_volume: "25_100",
    current_tool: "taxdome",
    current_tool_other: null,
    phone: "+1 514 555 0100",
    province: "QC",
    preferred_language: "fr",
    marketing_opt_in: true,
    furthest_step: 3,
    booked_at: null,
    notified_at: null,
    notion_page_id: null,
    created_at: "2026-05-22T20:00:00Z",
    updated_at: "2026-05-22T20:05:00Z",
    ...extra,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  updateMock.mockClear();
  eqMock.mockClear();
  process.env.NOTION_API_KEY = "secret_test_key";
  process.env.NOTION_LEADS_DB_ID = "test-db-id";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NOTION_API_KEY;
  delete process.env.NOTION_LEADS_DB_ID;
});

describe("pushLeadToNotion — create path", () => {
  it("POSTs to /v1/pages with the parent db + full properties + saves the page id back", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "new-page-id" }), { status: 200 }),
    );

    await pushLeadToNotion(fakeRow());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.notion.com/v1/pages");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.parent.database_id).toBe("test-db-id");
    expect(body.properties.Email.email).toBe("phil@vylan.app");
    expect(body.properties.Firm.rich_text[0].text.content).toBe("Acme CPA");
    expect(body.properties.Status.select.name).toBe("New");
    expect(body.properties.Size.select.name).toBe("2-5 people");
    expect(body.properties["Current tool"].select.name).toBe("TaxDome");

    // The page id should have been written back to demo_requests.
    expect(updateMock).toHaveBeenCalledWith({ notion_page_id: "new-page-id" });
  });

  it("formats current_tool=other_software with the free-text follow-up", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "new-page-id" }), { status: 200 }),
    );

    await pushLeadToNotion(
      fakeRow({
        current_tool: "other_software",
        current_tool_other: "Citrix ShareFile",
      }),
    );

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.properties["Current tool"].select.name).toBe(
      "Other — Citrix ShareFile",
    );
  });

  it("falls back to email as title when contact_name is missing", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "new-page-id" }), { status: 200 }),
    );

    await pushLeadToNotion(fakeRow({ contact_name: null }));

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.properties.Name.title[0].text.content).toBe("phil@vylan.app");
  });
});

describe("pushLeadToNotion — update path", () => {
  it("PATCHes /v1/pages/:id when notion_page_id is set and DOES NOT touch Status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await pushLeadToNotion(
      fakeRow({ notion_page_id: "existing-page-id", booked_at: "2026-05-22T20:10:00Z" }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.notion.com/v1/pages/existing-page-id");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body as string);
    // Status is intentionally absent on update — founder owns it now.
    expect(body.properties.Status).toBeUndefined();
    // Booked timestamp should reflect now.
    expect(body.properties.Booked.checkbox).toBe(true);
    expect(body.properties["Booked at"].date.start).toBe("2026-05-22T20:10:00Z");
    // We do NOT write back the page id again (it's already set).
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("pushLeadToNotion — unconfigured", () => {
  it("silently no-ops when NOTION_API_KEY is missing", async () => {
    delete process.env.NOTION_API_KEY;
    await pushLeadToNotion(fakeRow());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("silently no-ops when NOTION_LEADS_DB_ID is missing", async () => {
    delete process.env.NOTION_LEADS_DB_ID;
    await pushLeadToNotion(fakeRow());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("pushLeadToNotion — failure modes", () => {
  it("swallows non-2xx Notion responses without throwing", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"object":"error","status":400,"code":"validation_error","message":"bad"}', {
        status: 400,
      }),
    );
    await expect(pushLeadToNotion(fakeRow())).resolves.not.toThrow();
    // Page id never saved on failure.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("swallows network errors without throwing", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(pushLeadToNotion(fakeRow())).resolves.not.toThrow();
  });
});

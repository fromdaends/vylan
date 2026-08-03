import { describe, it, expect, vi, beforeEach } from "vitest";

// The portal writes to the CLIENT activity feed, not the firm audit log —
// different actor, different ledger. See the route's header comment for why a
// portal download deliberately does not produce a firm-side file_downloaded
// row: the firm audit's actor is a firm user, and a portal visitor is not one.
const logActivity = vi.fn();
const logUserActivityAs = vi.fn();
const isPortalUnlocked = vi.fn();
const getFinalDocumentForDownloadSR = vi.fn();
const maybeSingle = vi.fn();
const afterCalls: Promise<unknown>[] = [];

vi.mock("@/lib/db/portal", () => ({
  isValidTokenShape: (t: string) => t.length > 3,
  logActivity: (...a: unknown[]) => logActivity(...a),
}));
vi.mock("@/lib/db/activity", () => ({
  logUserActivityAs: (...a: unknown[]) => logUserActivityAs(...a),
}));
vi.mock("@/lib/portal/gate", () => ({
  isPortalUnlocked: (...a: unknown[]) => isPortalUnlocked(...a),
}));
vi.mock("@/lib/db/final-documents", () => ({
  getFinalDocumentForDownloadSR: (...a: unknown[]) =>
    getFinalDocumentForDownloadSR(...a),
}));
vi.mock("@/lib/db/payment-requests", () => ({
  getLatestPaymentRequestForEngagementSR: async () => null,
}));
vi.mock("@/lib/supabase/server", () => ({
  getServiceRoleSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}));
vi.mock("@/lib/storage", () => ({
  signedUrl: async () => "https://storage.test/signed",
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true }),
  ipFromRequest: () => "1.2.3.4",
  PORTAL_FILE_VIEW_PER_TOKEN: { limit: 100, window: "1 h" },
  PORTAL_FILE_VIEW_PER_IP: { limit: 100, window: "1 h" },
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  after: (fn: () => Promise<unknown>) => {
    afterCalls.push(Promise.resolve(fn()));
  },
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

function get(qs: string, headers: Record<string, string> = {}) {
  return GET(
    new NextRequest(
      new Request(`http://localhost/api/portal/deliverables/doc-1${qs}`, {
        headers,
      }),
    ),
    { params: Promise.resolve({ id: "doc-1" }) },
  ) as unknown as Promise<Response>;
}

const flush = () => Promise.all(afterCalls);

describe("GET /api/portal/deliverables/[id] — the download record", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCalls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    isPortalUnlocked.mockResolvedValue(true);
    maybeSingle.mockResolvedValue({
      data: {
        id: "eng-1",
        firm_id: "firm-1",
        status: "sent",
        magic_expires_at: null,
        invoice_locks_deliverables: false,
      },
    });
    getFinalDocumentForDownloadSR.mockResolvedValue({
      engagement_id: "eng-1",
      storage_path: "firms/f/final.pdf",
      original_filename: "return.pdf",
      display_name: "2025 tax return.pdf",
      mime_type: "application/pdf",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bytes", { status: 200 })),
    );
  });

  it("records exactly one client download, named as the portal named it", async () => {
    const res = await get("?token=tok-123&download=1");
    await flush();

    expect(res.status).toBe(200);
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith(
      "firm-1",
      "eng-1",
      "client_downloaded_deliverable",
      { name: "2025 tax return.pdf", ref: "doc-1" },
    );
  });

  it("never writes a firm-side audit row for a client's own download", async () => {
    await get("?token=tok-123&download=1");
    await flush();

    expect(logUserActivityAs).not.toHaveBeenCalled();
  });

  it("does not record a second time for the rest of the same download", async () => {
    await get("?token=tok-123&download=1");
    await get("?token=tok-123&download=1", { range: "bytes=4096-" });
    await flush();

    expect(logActivity).toHaveBeenCalledTimes(1);
  });

  it("records nothing when the token does not open this deliverable", async () => {
    maybeSingle.mockResolvedValue({ data: null });

    const res = await get("?token=tok-123&download=1");
    await flush();

    expect(res.status).toBe(404);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("records nothing behind the portal PIN gate", async () => {
    isPortalUnlocked.mockResolvedValue(false);

    const res = await get("?token=tok-123&download=1");
    await flush();

    expect(res.status).toBe(404);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("records nothing when the client only previews the file", async () => {
    const res = await get("?token=tok-123");
    await flush();

    expect(res.status).toBe(200);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const findEngagementForToken = vi.fn();
const logActivity = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("@/lib/db/portal", () => ({
  findEngagementForToken: (t: string) => findEngagementForToken(t),
  logActivity: (...a: unknown[]) => logActivity(...a),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (a: unknown) => checkRateLimit(a),
  PORTAL_ACTIVITY_PER_TOKEN: { limit: 300, window: "1 h" },
}));

import { POST } from "./route";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/portal/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  ) as unknown as Promise<Response>;
}

describe("POST /api/portal/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    checkRateLimit.mockResolvedValue({ ok: true });
    findEngagementForToken.mockResolvedValue({
      id: "eng-1",
      firm_id: "firm-1",
      client_id: "client-1",
      status: "sent",
    });
    logActivity.mockResolvedValue(undefined);
  });

  it("400s a missing token or action and never logs", async () => {
    const res = await post({ action: "client_viewed_portal" });
    expect(res.status).toBe(400);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("400s an action outside the allowlist and never touches the DB", async () => {
    const res = await post({ token: "tok", action: "invoice_waived" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_action");
    expect(findEngagementForToken).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("429s when rate limited, before resolving the token", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfter: 12 });
    const res = await post({ token: "tok", action: "client_viewed_portal" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(findEngagementForToken).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("404s an unknown/expired/cancelled token without logging", async () => {
    findEngagementForToken.mockResolvedValue(null);
    const res = await post({ token: "tok", action: "client_viewed_portal" });
    expect(res.status).toBe(404);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("logs a valid event against the resolved firm + engagement", async () => {
    const res = await post({
      token: "tok",
      action: "client_downloaded_deliverable",
      metadata: { name: "T4-2025.pdf", ref: "doc-9" },
    });
    expect(res.status).toBe(200);
    expect(logActivity).toHaveBeenCalledWith(
      "firm-1",
      "eng-1",
      "client_downloaded_deliverable",
      { name: "T4-2025.pdf", ref: "doc-9" },
    );
  });

  it("sanitizes metadata: drops unknown keys and truncates long strings", async () => {
    await post({
      token: "tok",
      action: "client_opened_signature",
      metadata: {
        name: "x".repeat(500),
        ref: "y".repeat(200),
        evil: "drop-me",
        nested: { a: 1 },
      },
    });
    const meta = logActivity.mock.calls[0][3] as Record<string, string>;
    expect(Object.keys(meta).sort()).toEqual(["name", "ref"]);
    expect(meta.name).toHaveLength(200);
    expect(meta.ref).toHaveLength(64);
  });

  it("still returns ok when the log write throws (best-effort)", async () => {
    logActivity.mockRejectedValue(new Error("db down"));
    const res = await post({ token: "tok", action: "client_viewed_portal" });
    expect(res.status).toBe(200);
  });
});

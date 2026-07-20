import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logPortalActivity } from "./activity-log";

describe("logPortalActivity", () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(null, { status: 200 })),
  );

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the token, action, and metadata to the activity endpoint", () => {
    logPortalActivity("tok-123", "client_viewed_portal", { name: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/portal/activity");
    expect(opts.method).toBe("POST");
    expect(opts.keepalive).toBe(true);
    expect(JSON.parse(opts.body as string)).toEqual({
      token: "tok-123",
      action: "client_viewed_portal",
      metadata: { name: "x" },
    });
  });

  it("no-ops when the token is empty (never hits the network)", () => {
    logPortalActivity("", "client_viewed_portal");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws, even if fetch itself throws synchronously", () => {
    fetchMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() =>
      logPortalActivity("tok", "client_opened_documents"),
    ).not.toThrow();
  });
});
